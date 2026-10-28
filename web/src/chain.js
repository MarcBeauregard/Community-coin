// Two ways to reach the contracts, behind one small interface:
//
//   LocalChain   an EVM running in the page itself, executing the compiled bytecode of the contracts.
//                Demo accounts, no gas, and a clock that runs in real time and can jump forward.
//   WalletChain  a real network through an injected wallet (window.ethereum).
//
// Both expose: accounts, now(), call(), send(), balance(), and LocalChain alone warp().

import { createEVM } from "@ethereumjs/evm";
import { Common, Mainnet, Hardfork } from "@ethereumjs/common";
import { createBlock } from "@ethereumjs/block";
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { BrowserProvider, getAddress, keccak256, toUtf8Bytes } from "ethers";

const GAS_LIMIT = 30_000_000n;

export class Reverted extends Error {
  constructor(data, reason) {
    super(reason ?? "execution reverted");
    this.data = data;
    this.reason = reason;
  }
}

export class LocalChain {
  static async create(names, ethEach = 100n * 10n ** 18n) {
    const chain = new LocalChain();
    chain.common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    chain.evm = await createEVM({ common: chain.common });
    // Deterministic demo addresses derived from the names.
    chain.accounts = names.map((name) => ({ name, address: getAddress("0x" + keccak256(toUtf8Bytes(`demo:${name}`)).slice(-40)) }));
    for (const { address } of chain.accounts) {
      await chain.evm.stateManager.putAccount(createAddressFromString(address), createAccount({ balance: ethEach }));
    }
    return chain;
  }

  constructor() {
    this.kind = "local";
    this.blockNumber = 0n;
    this.lastTimestamp = 0;
    this.startWall = Date.now();
    this.startChain = Math.floor(Date.now() / 1000);
    this.offset = 0;
  }

  /** Chain time in seconds: follows the wall clock, plus every jump forward. */
  now() {
    return Math.max(this.lastTimestamp, this.startChain + Math.floor((Date.now() - this.startWall) / 1000) + this.offset);
  }

  warp(seconds) {
    this.offset += seconds;
  }

  _block(timestamp) {
    return createBlock(
      { header: { number: this.blockNumber, timestamp: BigInt(timestamp), gasLimit: GAS_LIMIT } },
      { common: this.common },
    );
  }

  async _run({ from, to, data, value = 0n }, persist) {
    const sm = this.evm.stateManager;
    const timestamp = persist ? Math.max(this.now(), this.lastTimestamp + 1) : this.now();
    await sm.checkpoint();
    const result = await this.evm.runCall({
      caller: createAddressFromString(from),
      origin: createAddressFromString(from),
      to: to ? createAddressFromString(to) : undefined,
      data: hexToBytes(data),
      value,
      gasLimit: GAS_LIMIT,
      block: this._block(timestamp),
    });
    const { exceptionError, returnValue, logs = [] } = result.execResult;
    if (exceptionError || !persist) await sm.revert();
    else await sm.commit();
    if (exceptionError) throw new Reverted(bytesToHex(returnValue), exceptionError.error);
    if (persist) {
      this.blockNumber += 1n;
      this.lastTimestamp = timestamp;
    }
    return {
      returnData: bytesToHex(returnValue),
      createdAddress: result.createdAddress ? getAddress(result.createdAddress.toString()) : undefined,
      logs: logs.map(([address, topics, logData]) => ({
        address: getAddress(bytesToHex(address)),
        topics: topics.map(bytesToHex),
        data: bytesToHex(logData),
      })),
      timestamp,
    };
  }

  async call(from, to, data) {
    return (await this._run({ from, to, data }, false)).returnData;
  }

  async send(from, to, data, value = 0n) {
    return this._run({ from, to, data, value }, true);
  }

  async deploy(from, bytecode) {
    return (await this._run({ from, data: bytecode }, true)).createdAddress;
  }

  async balance(address) {
    const account = await this.evm.stateManager.getAccount(createAddressFromString(address));
    return account ? account.balance : 0n;
  }
}

export class WalletChain {
  static async connect() {
    if (!globalThis.ethereum) throw new Error("No wallet found in this browser.");
    const chain = new WalletChain();
    chain.provider = new BrowserProvider(globalThis.ethereum);
    const addresses = await chain.provider.send("eth_requestAccounts", []);
    chain.accounts = addresses.map((a, i) => ({ name: i === 0 ? "Wallet" : `Wallet ${i + 1}`, address: getAddress(a) }));
    chain.chainId = (await chain.provider.getNetwork()).chainId;
    chain.timestamp = (await chain.provider.getBlock("latest")).timestamp;
    chain.fetchedAt = Date.now();
    return chain;
  }

  constructor() {
    this.kind = "wallet";
  }

  now() {
    return this.timestamp + Math.floor((Date.now() - this.fetchedAt) / 1000);
  }

  async call(from, to, data) {
    try {
      return await this.provider.call({ from, to, data });
    } catch (e) {
      throw new Reverted(e?.data ?? e?.info?.error?.data ?? "0x");
    }
  }

  async send(from, to, data, value = 0n) {
    const signer = await this.provider.getSigner(from);
    let tx;
    try {
      tx = await signer.sendTransaction({ to, data, value });
    } catch (e) {
      if (e?.data) throw new Reverted(e.data);
      throw e;
    }
    const receipt = await tx.wait();
    const block = await this.provider.getBlock(receipt.blockNumber);
    this.timestamp = block.timestamp;
    this.fetchedAt = Date.now();
    return {
      logs: receipt.logs.map((l) => ({ address: getAddress(l.address), topics: [...l.topics], data: l.data })),
      timestamp: block.timestamp,
    };
  }

  async balance(address) {
    return this.provider.getBalance(address);
  }
}
