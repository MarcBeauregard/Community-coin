// Deploys the CommunityCoin hub to the network given with --network, using the parameters of the app.
//
//   RPC_URL=https://sepolia.base.org DEPLOYER_KEY=0x… FEE_RECIPIENT=0x… npx hardhat run scripts/deploy.js --network target
//
// FEE_RECIPIENT receives the protocol's cut of every trade fee (PROTOCOL_FEE_BPS, 20 = 0.2% of the trade, taken out
// of the 1%). Both are fixed forever at deployment; on a local chain the recipient defaults to the deployer.
//
// The contracts are not audited: deploy to a testnet. Before sending anything the script checks the chain and
// the deployer's balance; afterwards it reads the parameters back from the chain, records the deployment in
// deployments/<chainId>.json and registers the hub in web/src/deployments.js so the app can connect to it.

const { ethers, network } = require("hardhat");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const PARAMS = {
  openWindow: 300, // 5 minute batch opening
  vestWindow: 3600, // the opening batch vests over 1 hour
  spikeShareBps: 5000, // half of a sale's proceeds above the 1 hour reference price stays with the holders
  unionWindow: 3 * 24 * 3600, // 3 day union votes
  protocolFeeBps: Number(process.env.PROTOCOL_FEE_BPS ?? 20), // 0.2% of every trade to the protocol, out of the 1% fee
  feeRecipient: process.env.FEE_RECIPIENT ?? "",
};

const CHAINS = {
  8453: { name: "Base", explorer: "https://basescan.org" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  31337: { name: "Hardhat" },
};

const root = join(__dirname, "..");

/** Adds or replaces the entry for `chainId` in web/src/deployments.js. */
function registerInApp(chainId, entry) {
  const file = join(root, "web/src/deployments.js");
  const source = readFileSync(file, "utf8");
  const match = source.match(/export const DEPLOYMENTS = (\{[\s\S]*?\});/);
  const current = match ? Function(`return (${match[1]});`)() : {};
  current[chainId] = entry;
  const body = Object.entries(current)
    .map(([id, d]) => `  ${id}: { ${Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} },`)
    .join("\n");
  writeFileSync(file, source.replace(/export const DEPLOYMENTS = \{[\s\S]*?\};/, `export const DEPLOYMENTS = {\n${body}\n};`));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const chain = CHAINS[chainId] ?? { name: network.name };
  if (chainId === 8453 && process.env.I_KNOW_THIS_IS_MAINNET !== "yes") {
    throw new Error("Refusing to deploy unaudited contracts to Base mainnet. Set I_KNOW_THIS_IS_MAINNET=yes to override.");
  }

  if (!PARAMS.feeRecipient) {
    if (chainId !== 31337) throw new Error("Set FEE_RECIPIENT to the address that receives the protocol's fees: it cannot be changed after deployment.");
    PARAMS.feeRecipient = deployer.address;
  }
  if (!ethers.isAddress(PARAMS.feeRecipient)) throw new Error(`FEE_RECIPIENT is not an address: ${PARAMS.feeRecipient}`);
  PARAMS.feeRecipient = ethers.getAddress(PARAMS.feeRecipient);

  const factory = await ethers.getContractFactory("CommunityCoin");
  const deployTx = await factory.getDeployTransaction(...Object.values(PARAMS));
  const gas = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
  const fees = await ethers.provider.getFeeData();
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network   ${chain.name} (chain ${chainId})`);
  console.log(`Deployer  ${deployer.address}, ${ethers.formatEther(balance)} ETH`);
  console.log(`Estimate  ${gas} gas, at most ${ethers.formatEther(gas * price)} ETH`);
  console.log(`Fees      1% per trade: ${PARAMS.protocolFeeBps / 100}% to ${PARAMS.feeRecipient}, the rest to each meme's creator`);
  if (balance < gas * price) throw new Error("The deployer cannot pay for the deployment: fund it first.");

  const hub = await factory.deploy(...Object.values(PARAMS));
  const receipt = await hub.deploymentTransaction().wait(chainId === 31337 ? 1 : 2);
  const address = await hub.getAddress();
  console.log(`Deployed  ${address} in block ${receipt.blockNumber} (tx ${receipt.hash})`);

  // Read everything back from the chain before telling anyone about it.
  const onChain = {
    openWindow: Number(await hub.openWindow()),
    vestWindow: Number(await hub.vestWindow()),
    spikeShareBps: Number(await hub.spikeShareBps()),
    unionWindow: Number(await hub.unionWindow()),
    protocolFeeBps: Number(await hub.protocolFeeBps()),
    feeRecipient: await hub.feeRecipient(),
  };
  for (const [k, v] of Object.entries(PARAMS)) {
    if (onChain[k] !== v) throw new Error(`Parameter ${k} reads ${onChain[k]} on chain, expected ${v}.`);
  }
  if ((await hub.memeCount()) !== 0n) throw new Error("A fresh hub should have no memes.");
  console.log("Verified  parameters read back from the chain match");

  if (chainId !== 31337) {
    mkdirSync(join(root, "deployments"), { recursive: true });
    const record = {
      network: chain.name,
      chainId,
      hub: address,
      deployer: deployer.address,
      block: receipt.blockNumber,
      transaction: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      parameters: PARAMS,
      deployedAt: new Date((await ethers.provider.getBlock(receipt.blockNumber)).timestamp * 1000).toISOString(),
    };
    writeFileSync(join(root, `deployments/${chainId}.json`), JSON.stringify(record, null, 2) + "\n");
    registerInApp(chainId, { name: chain.name, hub: address, ...(chain.explorer ? { explorer: chain.explorer } : {}) });
    console.log(`Recorded  deployments/${chainId}.json and web/src/deployments.js`);
    if (chain.explorer) console.log(`Explorer  ${chain.explorer}/address/${address}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
