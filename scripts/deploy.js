// Deploys the CommunityCoin hub to the network given with --network, using the parameters of the app.
//
//   RPC_URL=https://sepolia.base.org DEPLOYER_KEY=0x… npx hardhat run scripts/deploy.js --network target
//
// The contracts are not audited: deploy to a testnet. The script prints the line to add to
// web/src/deployments.js so the app can connect to this hub through a wallet.

const { ethers, network } = require("hardhat");

const PARAMS = {
  openWindow: 300, // 5 minute batch opening
  vestWindow: 3600, // the opening batch vests over 1 hour
  spikeShareBps: 5000, // half of a sale's proceeds above the 1 hour reference price stays with the holders
  unionWindow: 3 * 24 * 3600, // 3 day union votes
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying from ${deployer.address} on ${network.name} (chain ${chainId})`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const hub = await ethers.deployContract("CommunityCoin", Object.values(PARAMS));
  await hub.waitForDeployment();
  const address = await hub.getAddress();
  const receipt = await hub.deploymentTransaction().wait();

  console.log(`CommunityCoin deployed at ${address} (block ${receipt.blockNumber})`);
  console.log("\nAdd this entry to DEPLOYMENTS in web/src/deployments.js, then rebuild the app:");
  console.log(`  ${chainId}: { name: "${network.name}", hub: "${address}" },`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
