// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract CarbonOffsetCertificate is
    Initializable,
    ERC721Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    /// @notice Two-stage certificate lifecycle:
    ///   STAGE 1 (CLAIMABLE): minted to vault, metadata mutable by MINTER, transferable once via reassign().
    ///   STAGE 2 (FINALIZED): assigned to end-user, metadata FROZEN, soulbound forever.
    /// @dev Invariants enforced on-chain:
    ///   I1: Metadata can be updated ONLY while _isCampaignToken[id] == true.
    ///   I2: reassign() and setCampaignMetadataUri() are callable ONLY by MINTER_ROLE.
    ///   I3: Once _isCampaignToken[id] becomes false, it can NEVER return to true.
    ///   I4: Transfer/approve on a finalized token reverts (SOULBOUND).
    ///   I5: Brand/user cannot self-trigger reassign or metadata update (gated by MINTER_ROLE).
    ///   I6: Stage transition is atomic: ownership + metadata + flag all change in one tx.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(uint256 => string) private _tokenURIs;

    /// @dev True while the token is Stage 1 (vault-held, claimable). Set to true in
    ///      batchMintCampaign(), set to false in reassign(). Never set true again.
    mapping(uint256 => bool) private _isCampaignToken;

    uint256 private _nextTokenId;

    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string metadataUri
    );

    event CampaignTokensMinted(
        uint256 indexed firstTokenId,
        uint256 indexed lastTokenId,
        address indexed vault,
        uint256 count
    );

    event CertificateReassigned(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        string newMetadataUri
    );

    event CampaignMetadataUpdated(
        uint256 indexed tokenId,
        string newMetadataUri
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address minter) public initializer {
        __ERC721_init("Carbon Offset Certificate", "COC");
        __AccessControl_init();

        require(admin != address(0), "Invalid admin");
        require(minter != address(0), "Invalid minter");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
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

    /// @notice Stage 1 batch mint: pre-mint `metadataUris.length` certificates to
    ///         `vault`, all marked as campaign tokens (mutable + transferable once).
    /// @dev Mirrors batchMint's 50-per-call limit. Caller must hold MINTER_ROLE.
    function batchMintCampaign(
        address vault,
        string[] calldata metadataUris
    ) external onlyRole(MINTER_ROLE) returns (uint256[] memory) {
        require(vault != address(0), "Invalid vault");
        uint256 count = metadataUris.length;
        require(count > 0 && count <= 50, "Invalid batch size");

        uint256[] memory tokenIds = new uint256[](count);
        uint256 firstId = _nextTokenId + 1;
        for (uint256 i = 0; i < count; i++) {
            _nextTokenId++;
            uint256 tokenId = _nextTokenId;
            // Mark Stage 1 BEFORE _safeMint so _update sees the right state if
            // any future override consults the flag during minting.
            _isCampaignToken[tokenId] = true;
            _safeMint(vault, tokenId);
            _tokenURIs[tokenId] = metadataUris[i];
            emit CertificateMinted(tokenId, vault, metadataUris[i]);
            tokenIds[i] = tokenId;
        }
        emit CampaignTokensMinted(firstId, _nextTokenId, vault, count);
        return tokenIds;
    }

    /// @notice Stage 1 -> Stage 2 transition. Atomic: ownership + metadata + flag
    ///         all change in one tx. After this call the token is permanently
    ///         sealed (invariants I1, I3, I4).
    /// @dev    Caller must hold MINTER_ROLE. Reverts if the token is not currently
    ///         a campaign token (I3 - no second transition).
    function reassign(
        uint256 tokenId,
        address newOwner,
        string calldata finalMetadataUri
    ) external onlyRole(MINTER_ROLE) {
        require(_isCampaignToken[tokenId], "Not a campaign token");
        require(newOwner != address(0), "Invalid recipient");
        address from = _ownerOf(tokenId);
        require(from != address(0), "Token does not exist");

        _tokenURIs[tokenId] = finalMetadataUri;
        // Transfer while the campaign flag is still true so _update permits it.
        _update(newOwner, tokenId, address(0));
        // Flag drops AFTER the transfer - token is now soulbound forever.
        _isCampaignToken[tokenId] = false;

        emit CertificateReassigned(tokenId, from, newOwner, finalMetadataUri);
    }

    /// @notice Update metadata of a Stage-1 (vault-held) certificate. Reverts on a
    ///         finalized token (I1).
    /// @dev    Caller must hold MINTER_ROLE.
    function setCampaignMetadataUri(
        uint256 tokenId,
        string calldata newMetadataUri
    ) external onlyRole(MINTER_ROLE) {
        require(
            _isCampaignToken[tokenId],
            "Token is finalized, metadata frozen"
        );
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        _tokenURIs[tokenId] = newMetadataUri;
        emit CampaignMetadataUpdated(tokenId, newMetadataUri);
    }

    /// @notice Public lifecycle stage check. Returns true if the token is in
    ///         Stage 1 (campaign, claimable); false if it has been reassigned to
    ///         a user (Stage 2) or was minted via legacy mint()/batchMint().
    function isCampaignToken(uint256 tokenId) external view returns (bool) {
        return _isCampaignToken[tokenId];
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    // =========== Block all transfers except campaign reassign path ===========

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Allow first mint (from == 0). For non-mint operations, allow ONLY
        // the controlled reassign path: campaign token + auth == address(0).
        if (
            from != address(0) &&
            (!_isCampaignToken[tokenId] || auth != address(0))
        ) {
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
    )
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
