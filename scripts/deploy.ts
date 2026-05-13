import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const minter = process.env.MINTER_ADDRESS || deployer.address;

  const Contract = await ethers.getContractFactory("CarbonOffsetCertificate");
  const contract = await upgrades.deployProxy(Contract, [admin, minter], {
    initializer: "initialize",
    kind: "uups",
  });

  await contract.waitForDeployment();

  const proxyAddress = await contract.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress,
  );

  console.log("CarbonOffsetCertificate proxy deployed to:", proxyAddress);
  console.log("CarbonOffsetCertificate implementation:", implementationAddress);
  console.log("Admin:", admin);
  console.log("Minter:", minter);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
