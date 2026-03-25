import { ethers } from "hardhat";

async function main() {
  const Contract = await ethers.getContractFactory("CarbonOffsetCertificate");
  const contract = await Contract.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("CarbonOffsetCertificate deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
