import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { CarbonOffsetCertificate } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CarbonOffsetCertificate", function () {
  let contract: CarbonOffsetCertificate;
  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let nonMinter: SignerWithAddress;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const SAMPLE_URI = "ipfs://QmSampleHash123/metadata.json";
  const SAMPLE_URI_2 = "ipfs://QmSampleHash456/metadata.json";

  beforeEach(async function () {
    [owner, minter, user1, user2, nonMinter] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CarbonOffsetCertificate");
    const deployed = await upgrades.deployProxy(
      Factory,
      [owner.address, owner.address],
      {
        initializer: "initialize",
        kind: "uups",
      },
    );

    await deployed.waitForDeployment();
    contract = deployed as unknown as CarbonOffsetCertificate;
  });

  describe("Deployment", function () {
    it("should grant DEFAULT_ADMIN_ROLE to admin", async function () {
      expect(await contract.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be
        .true;
    });

    it("should grant MINTER_ROLE to minter", async function () {
      expect(await contract.hasRole(MINTER_ROLE, owner.address)).to.be.true;
    });

    it("should have correct name and symbol", async function () {
      expect(await contract.name()).to.equal("Carbon Offset Certificate");
      expect(await contract.symbol()).to.equal("COC");
    });

    it("initializer should not be callable twice", async function () {
      await expect(contract.initialize(owner.address, owner.address)).to.be
        .reverted;
    });
  });

  describe("Minting", function () {
    it("should mint a token and return correct tokenId", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      expect(await contract.ownerOf(1)).to.equal(user1.address);
    });

    it("should return correct tokenURI after mint", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      expect(await contract.tokenURI(1)).to.equal(SAMPLE_URI);
    });

    it("should increment tokenId for each mint", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      await contract.mint(user2.address, SAMPLE_URI_2);
      expect(await contract.ownerOf(1)).to.equal(user1.address);
      expect(await contract.ownerOf(2)).to.equal(user2.address);
    });
  });

  describe("Access Control", function () {
    it("should revert if non-minter tries to mint", async function () {
      await expect(contract.connect(nonMinter).mint(user1.address, SAMPLE_URI))
        .to.be.reverted;
    });

    it("should revert if non-minter tries to batchMint", async function () {
      await expect(
        contract.connect(nonMinter).batchMint([user1.address], [SAMPLE_URI]),
      ).to.be.reverted;
    });

    it("should allow granted minter to mint", async function () {
      await contract.grantRole(MINTER_ROLE, minter.address);
      await contract.connect(minter).mint(user1.address, SAMPLE_URI);
      expect(await contract.ownerOf(1)).to.equal(user1.address);
    });
  });

  describe("Soulbound (Non-Transferable)", function () {
    beforeEach(async function () {
      await contract.mint(user1.address, SAMPLE_URI);
    });

    it("should revert on transferFrom", async function () {
      await expect(
        contract.connect(user1).transferFrom(user1.address, user2.address, 1),
      ).to.be.revertedWith("SOULBOUND: non-transferable");
    });

    it("should revert on safeTransferFrom", async function () {
      await expect(
        contract
          .connect(user1)
          ["safeTransferFrom(address,address,uint256)"](
            user1.address,
            user2.address,
            1,
          ),
      ).to.be.revertedWith("SOULBOUND: non-transferable");
    });

    it("should revert on approve", async function () {
      await expect(
        contract.connect(user1).approve(user2.address, 1),
      ).to.be.revertedWith("SOULBOUND: approvals disabled");
    });

    it("should revert on setApprovalForAll", async function () {
      await expect(
        contract.connect(user1).setApprovalForAll(user2.address, true),
      ).to.be.revertedWith("SOULBOUND: approvals disabled");
    });

    it("should return address(0) for getApproved", async function () {
      expect(await contract.getApproved(1)).to.equal(ethers.ZeroAddress);
    });

    it("should return false for isApprovedForAll", async function () {
      expect(await contract.isApprovedForAll(user1.address, user2.address)).to
        .be.false;
    });
  });

  describe("Metadata behaviour", function () {
    it("should preserve original URI after multiple legacy mints", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      await contract.mint(user2.address, SAMPLE_URI_2);
      expect(await contract.tokenURI(1)).to.equal(SAMPLE_URI);
      expect(await contract.tokenURI(2)).to.equal(SAMPLE_URI_2);
    });

    it("legacy token metadata cannot be changed via campaign setter", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      await expect(
        contract.setCampaignMetadataUri(1, SAMPLE_URI_2),
      ).to.be.revertedWith("Token is finalized, metadata frozen");
    });
  });

  describe("Batch Mint", function () {
    it("should mint multiple tokens in a batch", async function () {
      const recipients = [user1.address, user2.address, user1.address];
      const uris = [SAMPLE_URI, SAMPLE_URI_2, "ipfs://QmThird/metadata.json"];

      await contract.batchMint(recipients, uris);

      expect(await contract.ownerOf(1)).to.equal(user1.address);
      expect(await contract.ownerOf(2)).to.equal(user2.address);
      expect(await contract.ownerOf(3)).to.equal(user1.address);
      expect(await contract.tokenURI(1)).to.equal(SAMPLE_URI);
      expect(await contract.tokenURI(2)).to.equal(SAMPLE_URI_2);
      expect(await contract.tokenURI(3)).to.equal(
        "ipfs://QmThird/metadata.json",
      );
    });

    it("should return correct tokenIds from batchMint", async function () {
      await contract.mint(user1.address, SAMPLE_URI);

      const recipients = [user2.address, user2.address];
      const uris = [SAMPLE_URI, SAMPLE_URI_2];

      const result = await contract.batchMint.staticCall(recipients, uris);
      expect(result[0]).to.equal(2);
      expect(result[1]).to.equal(3);
    });

    it("should revert if arrays have different lengths", async function () {
      await expect(
        contract.batchMint([user1.address, user2.address], [SAMPLE_URI]),
      ).to.be.revertedWith("Arrays length mismatch");
    });
  });

  describe("Batch Mint Limit", function () {
    it("should revert if batch size exceeds 50", async function () {
      const recipients = Array(51).fill(user1.address);
      const uris = Array(51).fill(SAMPLE_URI);
      await expect(contract.batchMint(recipients, uris)).to.be.revertedWith(
        "Batch limit exceeded",
      );
    });

    it("should succeed with exactly 50 items", async function () {
      const recipients = Array(50).fill(user1.address);
      const uris = Array(50).fill(SAMPLE_URI);
      await contract.batchMint(recipients, uris);
      expect(await contract.ownerOf(50)).to.equal(user1.address);
    });
  });

  describe("Event Emission", function () {
    it("should emit CertificateMinted on mint", async function () {
      await expect(contract.mint(user1.address, SAMPLE_URI))
        .to.emit(contract, "CertificateMinted")
        .withArgs(1, user1.address, SAMPLE_URI);
    });

    it("should emit CertificateMinted for each token in batchMint", async function () {
      const tx = contract.batchMint(
        [user1.address, user2.address],
        [SAMPLE_URI, SAMPLE_URI_2],
      );
      await expect(tx)
        .to.emit(contract, "CertificateMinted")
        .withArgs(1, user1.address, SAMPLE_URI);
      await expect(tx)
        .to.emit(contract, "CertificateMinted")
        .withArgs(2, user2.address, SAMPLE_URI_2);
    });
  });

  describe("Role Management", function () {
    it("should allow admin to grant MINTER_ROLE", async function () {
      await contract.grantRole(MINTER_ROLE, minter.address);
      expect(await contract.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("should allow admin to revoke MINTER_ROLE", async function () {
      await contract.grantRole(MINTER_ROLE, minter.address);
      await contract.revokeRole(MINTER_ROLE, minter.address);
      expect(await contract.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it("should prevent non-admin from granting roles", async function () {
      await expect(
        contract.connect(nonMinter).grantRole(MINTER_ROLE, nonMinter.address),
      ).to.be.reverted;
    });

    it("should prevent revoked minter from minting", async function () {
      await contract.grantRole(MINTER_ROLE, minter.address);
      await contract.revokeRole(MINTER_ROLE, minter.address);
      await expect(contract.connect(minter).mint(user1.address, SAMPLE_URI)).to
        .be.reverted;
    });
  });

  describe("tokenURI Edge Cases", function () {
    it("should revert for non-existent token", async function () {
      await expect(contract.tokenURI(999)).to.be.reverted;
    });
  });

  describe("supportsInterface", function () {
    it("should support ERC721 interface", async function () {
      expect(await contract.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("should support AccessControl interface", async function () {
      expect(await contract.supportsInterface("0x7965db0b")).to.be.true;
    });
  });

  describe("Event-campaign lifecycle (Stage 1 ↔ Stage 2)", function () {
    const VAULT_URI = "ipfs://QmVaultPlaceholder1/metadata.json";
    const VAULT_URI_2 = "ipfs://QmVaultPlaceholder2/metadata.json";
    const FINAL_URI = "ipfs://QmFinalUserMetadata/metadata.json";

    describe("batchMintCampaign", function () {
      it("mints N tokens to vault, all marked Stage 1", async function () {
        const uris = [VAULT_URI, VAULT_URI_2];
        await contract.batchMintCampaign(owner.address, uris);
        expect(await contract.ownerOf(1)).to.equal(owner.address);
        expect(await contract.ownerOf(2)).to.equal(owner.address);
        expect(await contract.isCampaignToken(1)).to.be.true;
        expect(await contract.isCampaignToken(2)).to.be.true;
        expect(await contract.tokenURI(1)).to.equal(VAULT_URI);
      });

      it("emits CampaignTokensMinted with correct range", async function () {
        await expect(
          contract.batchMintCampaign(owner.address, [VAULT_URI, VAULT_URI_2]),
        )
          .to.emit(contract, "CampaignTokensMinted")
          .withArgs(1, 2, owner.address, 2);
      });

      it("reverts on zero vault address", async function () {
        await expect(
          contract.batchMintCampaign(ethers.ZeroAddress, [VAULT_URI]),
        ).to.be.revertedWith("Invalid vault");
      });

      it("reverts when batch is empty", async function () {
        await expect(
          contract.batchMintCampaign(owner.address, []),
        ).to.be.revertedWith("Invalid batch size");
      });

      it("reverts when batch exceeds 50", async function () {
        const uris = Array(51).fill(VAULT_URI);
        await expect(
          contract.batchMintCampaign(owner.address, uris),
        ).to.be.revertedWith("Invalid batch size");
      });

      it("[I2] reverts when caller is not MINTER_ROLE", async function () {
        await expect(
          contract
            .connect(nonMinter)
            .batchMintCampaign(owner.address, [VAULT_URI]),
        ).to.be.reverted;
      });
    });

    describe("reassign (Stage 1 -> Stage 2)", function () {
      beforeEach(async function () {
        await contract.batchMintCampaign(owner.address, [VAULT_URI]);
      });

      it("transfers from vault to user, updates metadata, clears flag (I6 atomicity)", async function () {
        await contract.reassign(1, user1.address, FINAL_URI);
        expect(await contract.ownerOf(1)).to.equal(user1.address);
        expect(await contract.tokenURI(1)).to.equal(FINAL_URI);
        expect(await contract.isCampaignToken(1)).to.be.false;
      });

      it("emits CertificateReassigned with correct args", async function () {
        await expect(contract.reassign(1, user1.address, FINAL_URI))
          .to.emit(contract, "CertificateReassigned")
          .withArgs(1, owner.address, user1.address, FINAL_URI);
      });

      it("[I2] reverts when caller is not MINTER_ROLE", async function () {
        await expect(
          contract.connect(nonMinter).reassign(1, user1.address, FINAL_URI),
        ).to.be.reverted;
      });

      it("[I3] reverts on second reassign of the same token", async function () {
        await contract.reassign(1, user1.address, FINAL_URI);
        await expect(
          contract.reassign(1, user2.address, FINAL_URI),
        ).to.be.revertedWith("Not a campaign token");
      });

      it("[I3] reverts on a legacy mint token", async function () {
        await contract.mint(user1.address, FINAL_URI);
        await expect(
          contract.reassign(2, user2.address, FINAL_URI),
        ).to.be.revertedWith("Not a campaign token");
      });

      it("reverts on zero new owner", async function () {
        await expect(
          contract.reassign(1, ethers.ZeroAddress, FINAL_URI),
        ).to.be.revertedWith("Invalid recipient");
      });
    });

    describe("setCampaignMetadataUri (I1 - metadata mutability)", function () {
      beforeEach(async function () {
        await contract.batchMintCampaign(owner.address, [VAULT_URI]);
      });

      it("[I1] succeeds for vault-held campaign token", async function () {
        await contract.setCampaignMetadataUri(1, VAULT_URI_2);
        expect(await contract.tokenURI(1)).to.equal(VAULT_URI_2);
      });

      it("[I1] reverts on finalized token", async function () {
        await contract.reassign(1, user1.address, FINAL_URI);
        await expect(
          contract.setCampaignMetadataUri(1, "ipfs://QmEvil/"),
        ).to.be.revertedWith("Token is finalized, metadata frozen");
      });

      it("[I1] reverts on legacy mint token", async function () {
        await contract.mint(user1.address, FINAL_URI);
        await expect(
          contract.setCampaignMetadataUri(2, VAULT_URI_2),
        ).to.be.revertedWith("Token is finalized, metadata frozen");
      });

      it("[I2] reverts when caller is not MINTER_ROLE", async function () {
        await expect(
          contract.connect(nonMinter).setCampaignMetadataUri(1, VAULT_URI_2),
        ).to.be.reverted;
      });
    });

    describe("Soulbound enforcement after Stage 2 (I4)", function () {
      beforeEach(async function () {
        await contract.batchMintCampaign(owner.address, [VAULT_URI]);
        await contract.reassign(1, user1.address, FINAL_URI);
      });

      it("[I4] transferFrom reverts after finalize", async function () {
        await expect(
          contract.connect(user1).transferFrom(user1.address, user2.address, 1),
        ).to.be.revertedWith("SOULBOUND: non-transferable");
      });

      it("[I4] safeTransferFrom reverts after finalize", async function () {
        await expect(
          contract
            .connect(user1)
            ["safeTransferFrom(address,address,uint256)"](
              user1.address,
              user2.address,
              1,
            ),
        ).to.be.revertedWith("SOULBOUND: non-transferable");
      });

      it("[I4] approve reverts after finalize", async function () {
        await expect(
          contract.connect(user1).approve(user2.address, 1),
        ).to.be.revertedWith("SOULBOUND: approvals disabled");
      });
    });

    describe("Vault custody invariants (I4 - vault cannot self-transfer)", function () {
      it("[I4] vault owner cannot transfer Stage-1 token via transferFrom", async function () {
        await contract.batchMintCampaign(owner.address, [VAULT_URI]);
        await expect(contract.transferFrom(owner.address, user1.address, 1)).to
          .be.reverted;
      });
    });

    describe("Legacy mint paths remain soulbound (regression)", function () {
      it("mint() then transferFrom still reverts", async function () {
        await contract.mint(user1.address, FINAL_URI);
        await expect(
          contract.connect(user1).transferFrom(user1.address, user2.address, 1),
        ).to.be.revertedWith("SOULBOUND: non-transferable");
      });

      it("batchMint() then transferFrom still reverts", async function () {
        await contract.batchMint([user1.address], [FINAL_URI]);
        await expect(
          contract.connect(user1).transferFrom(user1.address, user2.address, 1),
        ).to.be.revertedWith("SOULBOUND: non-transferable");
      });
    });
  });
});
