import { expect } from "chai";
import { ethers } from "hardhat";
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
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  // 1. Deployment
  describe("Deployment", function () {
    it("should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
      expect(await contract.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be
        .true;
    });

    it("should grant MINTER_ROLE to deployer", async function () {
      expect(await contract.hasRole(MINTER_ROLE, owner.address)).to.be.true;
    });

    it("should have correct name and symbol", async function () {
      expect(await contract.name()).to.equal("Carbon Offset Certificate");
      expect(await contract.symbol()).to.equal("COC");
    });
  });

  // 2. Minting
  describe("Minting", function () {
    it("should mint a token and return correct tokenId", async function () {
      const tx = await contract.mint(user1.address, SAMPLE_URI);
      const receipt = await tx.wait();
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

  // 3. Access Control
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

  // 4. Soulbound
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

  // 5. Metadata Immutability
  describe("Metadata Immutability", function () {
    it("should not have any function to change tokenURI", async function () {
      // Verify there's no setTokenURI or similar function in the ABI
      const abi = contract.interface.fragments;
      const setterFunctions = abi.filter(
        (f) =>
          f.type === "function" &&
          (f.name.toLowerCase().includes("settokenuri") ||
            f.name.toLowerCase().includes("seturi") ||
            f.name.toLowerCase().includes("updateuri") ||
            f.name.toLowerCase().includes("changuri")),
      );
      expect(setterFunctions.length).to.equal(0);
    });

    it("should preserve original URI after multiple mints", async function () {
      await contract.mint(user1.address, SAMPLE_URI);
      await contract.mint(user2.address, SAMPLE_URI_2);
      expect(await contract.tokenURI(1)).to.equal(SAMPLE_URI);
      expect(await contract.tokenURI(2)).to.equal(SAMPLE_URI_2);
    });
  });

  // 6. Batch Mint
  describe("Batch Mint", function () {
    it("should mint multiple tokens in a batch", async function () {
      const recipients = [user1.address, user2.address, user1.address];
      const uris = [SAMPLE_URI, SAMPLE_URI_2, "ipfs://QmThird/metadata.json"];

      const tx = await contract.batchMint(recipients, uris);
      await tx.wait();

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
      // First mint a single token to offset IDs
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

  // 7. Batch Mint Limit
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
      const tx = await contract.batchMint(recipients, uris);
      await tx.wait();
      expect(await contract.ownerOf(50)).to.equal(user1.address);
    });
  });

  // 8. Event Emission
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

  // 9. Role Management
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

  // tokenURI edge case
  describe("tokenURI Edge Cases", function () {
    it("should revert for non-existent token", async function () {
      await expect(contract.tokenURI(999)).to.be.reverted;
    });
  });

  // supportsInterface
  describe("supportsInterface", function () {
    it("should support ERC721 interface", async function () {
      expect(await contract.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("should support AccessControl interface", async function () {
      expect(await contract.supportsInterface("0x7965db0b")).to.be.true;
    });
  });
});
