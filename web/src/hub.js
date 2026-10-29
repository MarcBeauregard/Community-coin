// Typed access to the CommunityCoin hub and its meme tokens, over either chain.

import { Interface, ZeroAddress } from "ethers";
import contracts from "./contracts.json";
import { Reverted } from "./chain.js";

export const hubAbi = new Interface(contracts.CommunityCoin.abi);
export const tokenAbi = new Interface(contracts.MemeToken.abi);

const MESSAGES = {
  MemeExists: "This ticker is taken. Buy the original or launch a variant.",
  UnknownMeme: "This meme does not exist on this hub. Check you are on the right network.",
  InvalidSymbol: "Invalid ticker: use 1 to 16 letters or digits.",
  TooDeep: "Too deep: a family has 6 levels at most. Launch it as a variant of a meme higher up.",
  OpeningClosed: "The opening is over. Buy on the curve instead.",
  StillOpening: "The opening is still running. Commit to the auction or wait for it to close.",
  AlreadySettled: "The opening has already closed. Trade on the curve instead.",
  NothingToClaim: "Nothing to claim yet. Opening tokens unlock gradually: skip ahead or come back later.",
  ZeroAmount: "Enter an amount above zero.",
  WrongValue: "This meme is priced in another token. Pay with that token, or with ETH through the route.",
  Slippage: "The price moved more than 1% before your trade went through, so nothing happened. Try again.",
  NotRoot: "Only a root meme (quoted in ETH) can join another family.",
  CycleDetected: "These two memes are already in the same family.",
  UnknownUnion: "This union proposal does not exist.",
  VotingOpen: "The vote is still open. The union executes after the deadline.",
  VotingClosed: "The vote is closed. Unlock your tokens, or execute the union if it reached a majority.",
  QuorumNotReached: "No majority yet: more than half of the circulating supply must be locked when the vote closes.",
  ReserveTooSmall: "The reserve is too small for a union: it needs at least 0.001 ETH.",
  EthTransferFailed: "The ETH transfer failed. Try again, or check the receiving address.",
  ERC20InsufficientBalance: "Not enough tokens. Lower the amount or press Max.",
};

export function explain(error) {
  if (!(error instanceof Reverted)) {
    if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "You declined in your wallet. Nothing was sent.";
    return error?.shortMessage ?? error?.message ?? String(error);
  }
  if (error.reason === "insufficient balance") return "Not enough ETH. Lower the amount.";
  for (const abi of [hubAbi, tokenAbi]) {
    try {
      const parsed = abi.parseError(error.data);
      if (parsed) return MESSAGES[parsed.name] ?? parsed.name;
    } catch {}
  }
  return "The contract refused the transaction and nothing changed. Check the amount and try again.";
}

export class Hub {
  static async deploy(chain, from, args) {
    const data = contracts.CommunityCoin.bytecode + hubAbi.encodeDeploy(args).slice(2);
    return new Hub(chain, await chain.deploy(from, data));
  }

  constructor(chain, address) {
    this.chain = chain;
    this.address = address;
  }

  async read(fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, this.address, hubAbi.encodeFunctionData(fn, args));
    const out = hubAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  async token(token, fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, token, tokenAbi.encodeFunctionData(fn, args));
    const out = tokenAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  /** Sends a transaction and returns the hub events it emitted. `hooks` are passed to the chain (wallet progress). */
  async write(from, fn, args = [], value = 0n, hooks) {
    const receipt = await this.chain.send(from, this.address, hubAbi.encodeFunctionData(fn, args), value, hooks);
    const events = [];
    for (const log of receipt.logs) {
      if (log.address !== this.address) continue;
      try {
        events.push(hubAbi.parseLog(log));
      } catch {}
    }
    return { events, timestamp: receipt.timestamp, hash: receipt.hash };
  }
}
