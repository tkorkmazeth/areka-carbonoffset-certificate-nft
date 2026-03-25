// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CarbonOffsetCertificate is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(uint256 => string) private _tokenURIs;

    uint256 private _nextTokenId;

    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string metadataUri
    );

    constructor() ERC721("Carbon Offset Certificate", "COC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    function mint(
        address to,
        string calldata metadataUri
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        _nextTokenId++;
        uint256 tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = metadataUri;
        emit CertificateMinted(tokenId, to, metadataUri);
        return tokenId;
    }

    function batchMint(
        address[] calldata recipients,
        string[] calldata metadataUris
    ) external onlyRole(MINTER_ROLE) returns (uint256[] memory) {
        require(
            recipients.length == metadataUris.length,
            "Arrays length mismatch"
        );
        require(recipients.length <= 50, "Batch limit exceeded");

        uint256[] memory tokenIds = new uint256[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            _nextTokenId++;
            uint256 tokenId = _nextTokenId;
            _safeMint(recipients[i], tokenId);
            _tokenURIs[tokenId] = metadataUris[i];
            emit CertificateMinted(tokenId, recipients[i], metadataUris[i]);
            tokenIds[i] = tokenId;
        }
        return tokenIds;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    // =========== Block all transfers after mint ===========

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0)) {
            revert("SOULBOUND: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("SOULBOUND: approvals disabled");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("SOULBOUND: approvals disabled");
    }

    function getApproved(uint256) public pure override returns (address) {
        return address(0);
    }

    function isApprovedForAll(
        address,
        address
    ) public pure override returns (bool) {
        return false;
    }

    // =========== Required override ===========

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
