import { ethers } from "hardhat";

// Sepolia proxy adresini buraya yaz
const PROXY = "0x7075a16c912f2B229842Edd9E60F3EBfE1312fa2";
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function main() {
  const [signer] = await ethers.getSigners();
  const c = await ethers.getContractAt("CarbonOffsetCertificate", PROXY);

  console.log("Signer:", signer.address);

  // 1. Mint campaign token
  const mintTx = await c.batchMintCampaign(signer.address, ["ipfs://test"]);
  await mintTx.wait();
  console.log("batchMintCampaign done");

  // 2. Kontroller
  const isCampaign = await c.isCampaignToken(2);
  const owner = await c.ownerOf(2);
  const uri = await c.tokenURI(2);
  console.log({ isCampaign, owner, uri });

  // 3. Reassign
  const reassignTx = await c.reassign(2, DEAD, "ipfs://final");
  await reassignTx.wait();
  console.log("reassign done");

  // 4. Kontroller
  const isCampaign2 = await c.isCampaignToken(2);
  const owner2 = await c.ownerOf(2);
  const uri2 = await c.tokenURI(2);
  console.log({ isCampaign2, owner2, uri2 });

  // 5. Tekrar reassign (revert beklenir)
  try {
    await c.reassign(2, signer.address, "ipfs://retry");
  } catch (e) {
    console.log("reassign after finalize reverted as expected");
  }

  // 6. Metadata değişikliği (revert beklenir)
  try {
    await c.setCampaignMetadataUri(2, "ipfs://retry");
  } catch (e) {
    console.log("setCampaignMetadataUri after finalize reverted as expected");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
