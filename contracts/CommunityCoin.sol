// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MemeToken} from "./MemeToken.sol";

/// @title CommunityCoin
/// @notice A memecoin launchpad that turns the vamp/PvP game into a family game.
///
///  1. One meme, one ticker. Tickers are normalized (case, punctuation, leetspeak) and a duplicate cannot launch.
///  2. Lineage. A variant launches *inside* the family of the meme it copies: its curve is priced in the
///     parent token, so every buy of the copy is first a buy of the original, and money leaving a losing
///     variant lands back in the parent instead of leaving the meme.
///  3. Fair opening. The first `openWindow` seconds of every launch are a batch auction: all committers get
///     the same price, so sniping or bundling the first block buys nothing. The batch, which gets the
///     cheapest tokens, vests over `vestWindow`: the launch price cannot be dumped on the first wave.
///  4. Spike share. Meme PvP is selling into somebody else's wave. Whatever part of a sale executes above the
///     reference price (a one-hour moving price), `spikeShareBps` of the excess stays in the reserve and lifts
///     the price of every remaining token: the wave's sellers pay the wave's buyers. Selling patiently, or into
///     a falling market, costs nothing.
///  5. Union. A rival root can vote, with a majority of its supply, to join another family. Its ETH reserve
///     buys into the target and its curve is re-priced in the target token; balances are untouched and
///     dissenters can sell on the curve for the whole vote.
///
/// Every token trades on a virtual constant-product bonding curve whose reserve is held by this contract,
/// so the hub can always buy back the whole circulating supply of every token. No owner, no upgrade.
contract CommunityCoin is ReentrancyGuard {
    // ------------------------------------------------------------------ constants

    /// @notice Token side of every curve; total supply tends to it but never reaches it.
    uint256 public constant VIRTUAL_TOKENS = 1_000_000_000e18;
    /// @notice Virtual ETH a root curve starts with (sets the launch price).
    uint256 public constant ROOT_VIRTUAL_QUOTE = 1 ether;
    /// @notice Virtual parent tokens a variant curve starts with: variants of big memes start bigger.
    uint256 public constant CHILD_VIRTUAL_QUOTE = 1_000_000e18;
    /// @notice Fee on continuous trades, paid in the quote asset to the token's creator.
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS = 10_000;
    /// @notice Longest lineage allowed (a root has depth 0); bounds the gas of routed trades.
    uint256 public constant MAX_DEPTH = 6;
    uint256 public constant MAX_SYMBOL_BYTES = 32;
    uint256 public constant MAX_KEY_LENGTH = 16;
    /// @notice A union must bring at least this much ETH into the target family.
    uint256 public constant MIN_UNION_RESERVE = 0.001 ether;
    /// @notice The reference price closes the gap to the spot price linearly over this window.
    uint256 public constant REF_WINDOW = 1 hours;
    /// @notice Below this many outstanding tokens nobody is left to receive a spike share.
    uint256 public constant DUST_TOKENS = 1e9;

    /// @notice Length of the batch-auction opening of every launch, in seconds.
    uint256 public immutable openWindow;
    /// @notice Tokens bought in the opening batch unlock linearly over this many seconds after it closes.
    uint256 public immutable vestWindow;
    /// @notice Share of the proceeds above the reference price that a sale leaves in the reserve.
    uint256 public immutable spikeShareBps;
    /// @notice Length of a union vote, in seconds.
    uint256 public immutable unionWindow;

    // ------------------------------------------------------------------ state

    struct Meme {
        address parent; // quote asset; address(0) means ETH (a root)
        uint64 openUntil; // end of the batch-auction opening
        bool settled; // opening batch executed, continuous trading enabled
        uint8 height; // height of the subtree below this meme (0 for a leaf)
        address creator;
        uint64 refTime; // last update of the reference price
        uint256 ref; // reference price: quote per whole token, 1e18-scaled, trailing the spot price
        uint256 vQuote; // virtual quote reserve, floor included
        uint256 vToken; // virtual token reserve
        uint256 floor; // virtual part of vQuote: the real reserve is vQuote - floor
        uint256 batchQuote; // quote committed during the opening
        uint256 batchTokens; // tokens bought by the opening batch, shared pro rata
    }

    struct Union {
        address meme; // root asking to join
        address target; // meme whose family it joins
        uint64 deadline;
        bool executed;
        uint256 locked; // meme tokens locked in favour
    }

    mapping(address token => Meme) public memes;
    mapping(bytes32 key => address token) public tokenOfKey;
    mapping(address token => mapping(address user => uint256)) public committed;
    mapping(address token => mapping(address user => uint256)) public claimed;
    mapping(address creator => mapping(address asset => uint256)) public feesOf;
    mapping(address token => address[]) internal _children;
    address[] public allMemes;

    Union[] public unions;
    mapping(uint256 id => mapping(address voter => uint256)) public lockedOf;
    /// @notice Tokens of a meme locked across all of its union votes.
    mapping(address token => uint256) public escrowed;

    // ------------------------------------------------------------------ events

    event Launched(address indexed token, address indexed parent, address indexed creator, string name, string symbol);
    event Committed(address indexed token, address indexed user, uint256 quote);
    event Settled(address indexed token, uint256 quote, uint256 tokens);
    event Claimed(address indexed token, address indexed user, uint256 amount);
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 spikeShare
    );
    event FeesClaimed(address indexed creator, address indexed asset, uint256 amount);
    event UnionProposed(uint256 indexed id, address indexed meme, address indexed target, uint64 deadline);
    event UnionLocked(uint256 indexed id, address indexed voter, uint256 amount);
    event UnionUnlocked(uint256 indexed id, address indexed voter, uint256 amount);
    event UnionExecuted(uint256 indexed id, address indexed meme, address indexed target, uint256 ethIn, uint256 targetIn);

    // ------------------------------------------------------------------ errors

    error MemeExists(address token);
    error UnknownMeme();
    error InvalidSymbol();
    error TooDeep();
    error OpeningClosed();
    error StillOpening();
    error AlreadySettled();
    error NothingToClaim();
    error ZeroAmount();
    error WrongValue();
    error Slippage();
    error NotRoot();
    error CycleDetected();
    error UnknownUnion();
    error VotingOpen();
    error VotingClosed();
    error QuorumNotReached();
    error ReserveTooSmall();
    error ReserveInvariant();
    error EthTransferFailed();
    error InvalidConfig();

    modifier known(address token) {
        if (memes[token].creator == address(0)) revert UnknownMeme();
        _;
    }

    constructor(uint256 openWindow_, uint256 vestWindow_, uint256 spikeShareBps_, uint256 unionWindow_) {
        if (spikeShareBps_ + FEE_BPS > BPS) revert InvalidConfig();
        openWindow = openWindow_;
        vestWindow = vestWindow_;
        spikeShareBps = spikeShareBps_;
        unionWindow = unionWindow_;
    }

    // ------------------------------------------------------------------ launch

    /// @notice Launch a meme. `parent == address(0)` launches a root quoted in ETH; otherwise the new meme
    /// is a variant quoted in `parent`. ETH sent along is committed to the opening batch on the creator's behalf.
    function launch(string calldata name, string calldata symbol, address parent)
        external
        payable
        nonReentrant
        returns (address token)
    {
        bytes32 key = symbolKey(symbol);
        address existing = tokenOfKey[key];
        if (existing != address(0)) revert MemeExists(existing);
        uint256 virtualQuote = ROOT_VIRTUAL_QUOTE;
        if (parent != address(0)) {
            if (memes[parent].creator == address(0)) revert UnknownMeme();
            if (depthOf(parent) + 1 > MAX_DEPTH) revert TooDeep();
            virtualQuote = CHILD_VIRTUAL_QUOTE;
        }

        token = address(new MemeToken(name, symbol));
        Meme storage m = memes[token];
        m.parent = parent;
        m.creator = msg.sender;
        m.openUntil = uint64(block.timestamp + openWindow);
        m.vQuote = virtualQuote;
        m.floor = virtualQuote;
        m.vToken = VIRTUAL_TOKENS;
        _resetRef(m);
        tokenOfKey[key] = token;
        allMemes.push(token);
        if (parent != address(0)) {
            _children[parent].push(token);
            _raiseHeights(parent, 1);
        }
        emit Launched(token, parent, msg.sender, name, symbol);

        if (msg.value > 0) _commit(token, msg.sender, _ethToQuote(token, msg.value));
    }

    // ------------------------------------------------------------------ fair opening

    /// @notice Commit the quote asset (ETH for a root, parent tokens for a variant) to the opening batch.
    function commit(address token, uint256 quoteAmount) external payable nonReentrant known(token) {
        _pullQuote(token, msg.sender, quoteAmount);
        _commit(token, msg.sender, quoteAmount);
    }

    /// @notice Commit ETH to the opening batch; for a variant the ETH is first routed through its ancestors.
    function commitEth(address token, uint256 minQuote) external payable nonReentrant known(token) {
        uint256 quote = _ethToQuote(token, msg.value);
        if (quote < minQuote) revert Slippage();
        _commit(token, msg.sender, quote);
    }

    /// @notice Close the opening: the whole batch buys on the curve at once. Anyone can call it, and any
    /// trade on the meme calls it lazily.
    function settle(address token) external nonReentrant known(token) {
        _settle(token);
    }

    /// @notice Withdraw the vested part of your share of the opening batch. Everyone in the batch paid the
    /// same price.
    function claim(address token) external nonReentrant known(token) returns (uint256 amount) {
        Meme storage m = _tradable(token);
        amount = _vested(m, m.batchTokens, committed[token][msg.sender]) - claimed[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimed[token][msg.sender] += amount;
        MemeToken(token).mint(msg.sender, amount);
        emit Claimed(token, msg.sender, amount);
    }

    // ------------------------------------------------------------------ trading

    /// @notice Buy with the quote asset: ETH for a root, parent tokens for a variant.
    function buy(address token, uint256 quoteAmount, uint256 minOut)
        external
        payable
        nonReentrant
        known(token)
        returns (uint256 out)
    {
        _pullQuote(token, msg.sender, quoteAmount);
        out = _buyHop(token, quoteAmount, true);
        if (out < minOut) revert Slippage();
        MemeToken(token).mint(msg.sender, out);
    }

    /// @notice Buy any meme with ETH. A variant is bought through every ancestor, root first.
    function buyEth(address token, uint256 minOut) external payable nonReentrant known(token) returns (uint256 out) {
        out = _buyPath(token, msg.value, msg.sender, true);
        if (out < minOut) revert Slippage();
    }

    /// @notice Sell for the quote asset: ETH for a root, parent tokens for a variant.
    function sell(address token, uint256 amount, uint256 minOut) external nonReentrant known(token) returns (uint256 out) {
        if (amount == 0) revert ZeroAmount();
        MemeToken(token).burn(msg.sender, amount);
        out = _sellHop(token, amount);
        if (out < minOut) revert Slippage();
        _pushQuote(token, msg.sender, out);
    }

    /// @notice Sell any meme all the way back to ETH through every ancestor.
    function sellToEth(address token, uint256 amount, uint256 minOut)
        external
        nonReentrant
        known(token)
        returns (uint256 out)
    {
        if (amount == 0) revert ZeroAmount();
        MemeToken(token).burn(msg.sender, amount);
        out = _sellHop(token, amount);
        for (address p = memes[token].parent; p != address(0); p = memes[p].parent) {
            MemeToken(p).burn(address(this), out);
            out = _sellHop(p, out);
        }
        if (out < minOut) revert Slippage();
        _sendEth(msg.sender, out);
    }

    /// @notice Withdraw creator fees accrued in `asset` (address(0) for ETH).
    function claimFees(address asset) external nonReentrant returns (uint256 amount) {
        amount = feesOf[msg.sender][asset];
        if (amount == 0) revert NothingToClaim();
        feesOf[msg.sender][asset] = 0;
        if (asset == address(0)) _sendEth(msg.sender, amount);
        else MemeToken(asset).transfer(msg.sender, amount);
        emit FeesClaimed(msg.sender, asset, amount);
    }

    // ------------------------------------------------------------------ union

    /// @notice Propose that root `meme` joins the family of `target`.
    function proposeUnion(address meme, address target)
        external
        nonReentrant
        known(meme)
        known(target)
        returns (uint256 id)
    {
        if (memes[meme].parent != address(0)) revert NotRoot();
        if (rootOf(target) == meme) revert CycleDetected();
        _tradable(meme);
        uint64 deadline = uint64(block.timestamp + unionWindow);
        id = unions.length;
        unions.push(Union({meme: meme, target: target, deadline: deadline, executed: false, locked: 0}));
        emit UnionProposed(id, meme, target, deadline);
    }

    /// @notice Lock meme tokens in favour of a union. They can be unlocked at any time, before or after.
    function lockUnion(uint256 id, uint256 amount) external nonReentrant {
        Union storage u = _union(id);
        if (u.executed || block.timestamp > u.deadline) revert VotingClosed();
        if (amount == 0) revert ZeroAmount();
        MemeToken(u.meme).hubTransfer(msg.sender, address(this), amount);
        lockedOf[id][msg.sender] += amount;
        u.locked += amount;
        escrowed[u.meme] += amount;
        emit UnionLocked(id, msg.sender, amount);
    }

    function unlockUnion(uint256 id) external nonReentrant returns (uint256 amount) {
        Union storage u = _union(id);
        amount = lockedOf[id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        lockedOf[id][msg.sender] = 0;
        if (!u.executed) u.locked -= amount;
        escrowed[u.meme] -= amount;
        MemeToken(u.meme).transfer(msg.sender, amount);
        emit UnionUnlocked(id, msg.sender, amount);
    }

    /// @notice After the vote, if more than half of the circulating supply is locked in favour, the meme joins the
    /// target family: its whole ETH reserve buys the target (fee-free) and its curve is re-priced in the
    /// target token at the rate obtained. Holder balances do not change.
    function executeUnion(uint256 id, uint256 minTargetIn) external nonReentrant {
        Union storage u = _union(id);
        if (u.executed) revert VotingClosed();
        if (block.timestamp <= u.deadline) revert VotingOpen();
        Meme storage m = memes[u.meme];
        if (m.parent != address(0)) revert NotRoot();
        if (u.locked * 2 <= circulatingSupply(u.meme)) revert QuorumNotReached();
        if (rootOf(u.target) == u.meme) revert CycleDetected();
        if (depthOf(u.target) + 1 + m.height > MAX_DEPTH) revert TooDeep();

        uint256 ethIn = m.vQuote - m.floor;
        if (ethIn < MIN_UNION_RESERVE) revert ReserveTooSmall();
        u.executed = true;

        uint256 targetIn = _buyPath(u.target, ethIn, address(this), false);
        if (targetIn < minTargetIn) revert Slippage();
        // Same curve, same holders, now quoted in the target at the rate obtained.
        _rescale(m, targetIn);
        if (m.floor == 0) revert ReserveTooSmall();
        m.parent = u.target;
        _children[u.target].push(u.meme);
        _raiseHeights(u.target, uint256(m.height) + 1);
        emit UnionExecuted(id, u.meme, u.target, ethIn, targetIn);
    }

    // ------------------------------------------------------------------ views

    /// @notice Canonical key of a ticker: case, punctuation and common leetspeak are folded away,
    /// so "PNUT", "$pnut", "P.N.U.T" and "PNU7" are the same meme.
    function symbolKey(string memory symbol) public pure returns (bytes32) {
        bytes memory raw = bytes(symbol);
        if (raw.length == 0 || raw.length > MAX_SYMBOL_BYTES) revert InvalidSymbol();
        bytes memory key = new bytes(raw.length);
        uint256 n;
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            if (c >= 0x61 && c <= 0x7a) c -= 0x20; // a-z -> A-Z
            else if (c == 0x30) c = 0x4f; // 0 -> O
            else if (c == 0x31) c = 0x49; // 1 -> I
            else if (c == 0x33) c = 0x45; // 3 -> E
            else if (c == 0x34) c = 0x41; // 4 -> A
            else if (c == 0x35) c = 0x53; // 5 -> S
            else if (c == 0x37) c = 0x54; // 7 -> T
            if ((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)) key[n++] = bytes1(c);
        }
        if (n == 0 || n > MAX_KEY_LENGTH) revert InvalidSymbol();
        assembly ("memory-safe") {
            mstore(key, n)
        }
        return keccak256(key);
    }

    /// @notice Supply in the hands of holders: excludes tokens the hub holds as reserves of variants or
    /// as unclaimed fees, but includes tokens locked in union votes.
    function circulatingSupply(address token) public view returns (uint256) {
        MemeToken t = MemeToken(token);
        return t.totalSupply() - t.balanceOf(address(this)) + escrowed[token];
    }

    function memeCount() external view returns (uint256) {
        return allMemes.length;
    }

    function unionCount() external view returns (uint256) {
        return unions.length;
    }

    function childrenOf(address token) external view returns (address[] memory) {
        return _children[token];
    }

    function depthOf(address token) public view returns (uint256 depth) {
        for (address p = memes[token].parent; p != address(0); p = memes[p].parent) ++depth;
    }

    function rootOf(address token) public view returns (address root) {
        root = token;
        for (address p = memes[token].parent; p != address(0); p = memes[p].parent) root = p;
    }

    /// @notice The meme's ancestors, root first, ending with the meme itself.
    function lineageOf(address token) public view returns (address[] memory path) {
        uint256 n = depthOf(token) + 1;
        path = new address[](n);
        address t = token;
        for (uint256 i = n; i > 0; --i) {
            path[i - 1] = t;
            t = memes[t].parent;
        }
    }

    /// @notice Quote asset actually held for this meme's curve (ETH or parent tokens).
    function realReserve(address token) external view returns (uint256) {
        Meme storage m = memes[token];
        return m.vQuote - m.floor;
    }

    /// @notice Spot price in quote asset per whole token, scaled by 1e18.
    function priceOf(address token) external view known(token) returns (uint256) {
        (uint256 vQuote, uint256 vToken) = _liveCurve(token);
        return Math.mulDiv(vQuote, 1e18, vToken);
    }

    /// @notice Spot price in ETH per whole token, scaled by 1e18, through the whole lineage.
    function priceInEth(address token) external view known(token) returns (uint256 price) {
        address[] memory path = lineageOf(token);
        price = 1e18;
        for (uint256 i; i < path.length; ++i) {
            (uint256 vQuote, uint256 vToken) = _liveCurve(path[i]);
            price = Math.mulDiv(price, vQuote, vToken);
        }
    }

    /// @notice Tokens received by `buyEth(token)` for `ethIn`, fees included.
    function quoteBuyEth(address token, uint256 ethIn) external view known(token) returns (uint256 out) {
        address[] memory path = lineageOf(token);
        out = ethIn;
        for (uint256 i; i < path.length; ++i) {
            (uint256 vQuote, uint256 vToken) = _liveCurve(path[i]);
            (out,,) = _buyOut(vQuote, vToken, out - out * FEE_BPS / BPS);
        }
    }

    /// @notice ETH received by `sellToEth(token, amount)`, fees and spike share included.
    function quoteSellToEth(address token, uint256 amount) external view known(token) returns (uint256 out) {
        out = amount;
        for (address t = token; t != address(0); t = memes[t].parent) {
            (uint256 vQuote, uint256 vToken) = _liveCurve(t);
            uint256 ref = _refNow(memes[t], vQuote, vToken);
            (uint256 gross, uint256 newVQuote, uint256 newVToken) = _sellOut(vQuote, vToken, out);
            uint256 spike =
                _nobodyLeft(newVQuote - memes[t].floor, newVToken) ? 0 : _spikeShare(vQuote, vToken, ref, out, gross);
            out = gross - gross * FEE_BPS / BPS - spike;
        }
    }

    /// @notice Reference price (quote per whole token, 1e18-scaled) a sale would be measured against now.
    function referencePrice(address token) external view known(token) returns (uint256) {
        (uint256 vQuote, uint256 vToken) = _liveCurve(token);
        return _refNow(memes[token], vQuote, vToken);
    }

    /// @notice Tokens `user` can claim from the opening batch right now.
    function claimable(address token, address user) external view returns (uint256) {
        Meme storage m = memes[token];
        if (block.timestamp < m.openUntil) return 0;
        uint256 batchTokens = m.batchTokens;
        if (!m.settled) (batchTokens,,) = _buyOut(m.vQuote, m.vToken, m.batchQuote);
        return _vested(m, batchTokens, committed[token][user]) - claimed[token][user];
    }

    // ------------------------------------------------------------------ internals

    function _commit(address token, address user, uint256 quote) internal {
        Meme storage m = memes[token];
        if (quote == 0) revert ZeroAmount();
        if (m.settled || block.timestamp >= m.openUntil) revert OpeningClosed();
        m.batchQuote += quote;
        committed[token][user] += quote;
        emit Committed(token, user, quote);
    }

    function _settle(address token) internal {
        Meme storage m = memes[token];
        if (m.settled) revert AlreadySettled();
        if (block.timestamp < m.openUntil) revert StillOpening();
        m.settled = true;
        if (m.batchQuote > 0) m.batchTokens = _curveBuy(m, m.batchQuote);
        _resetRef(m); // the batch price is the meme's first real price
        emit Settled(token, m.batchQuote, m.batchTokens);
    }

    /// @dev Part of a batch share unlocked so far. Only called once the opening is over.
    function _vested(Meme storage m, uint256 batchTokens, uint256 share) internal view returns (uint256) {
        if (share == 0) return 0;
        uint256 total = Math.mulDiv(batchTokens, share, m.batchQuote);
        uint256 elapsed = block.timestamp - m.openUntil;
        return elapsed >= vestWindow ? total : Math.mulDiv(total, elapsed, vestWindow);
    }

    function _tradable(address token) internal returns (Meme storage m) {
        m = memes[token];
        if (!m.settled) _settle(token);
    }

    /// @dev Turns ETH into the quote asset of `token`, keeping it in the hub.
    function _ethToQuote(address token, uint256 ethIn) internal returns (uint256) {
        address parent = memes[token].parent;
        if (parent == address(0)) return ethIn;
        return _buyPath(parent, ethIn, address(this), true);
    }

    /// @dev Buys `token` with ETH through its whole lineage. Intermediate tokens never leave the hub:
    /// they become the reserve of the next curve down.
    function _buyPath(address token, uint256 ethIn, address recipient, bool takeFee) internal returns (uint256 out) {
        if (ethIn == 0) revert ZeroAmount();
        address[] memory path = lineageOf(token);
        out = ethIn;
        for (uint256 i; i < path.length; ++i) {
            out = _buyHop(path[i], out, takeFee);
            MemeToken(path[i]).mint(i + 1 == path.length ? recipient : address(this), out);
        }
    }

    function _buyHop(address token, uint256 quoteIn, bool takeFee) internal returns (uint256 out) {
        Meme storage m = _tradable(token);
        _updateRef(m);
        uint256 fee = takeFee ? _takeFee(m, quoteIn) : 0;
        out = _curveBuy(m, quoteIn - fee);
        emit Trade(token, msg.sender, true, quoteIn, out, fee, 0);
    }

    function _sellHop(address token, uint256 tokensIn) internal returns (uint256 out) {
        Meme storage m = _tradable(token);
        _updateRef(m);
        (uint256 vQuote, uint256 vToken) = (m.vQuote, m.vToken);
        uint256 gross = _curveSell(m, tokensIn);
        uint256 fee = _takeFee(m, gross);
        uint256 reserve = m.vQuote - m.floor;
        uint256 spike = _nobodyLeft(reserve, m.vToken) ? 0 : _spikeShare(vQuote, vToken, m.ref, tokensIn, gross);
        // Left in the reserve for the tokens still out there: the whole curve is re-priced up.
        if (spike > 0) _rescale(m, reserve + spike);
        out = gross - fee - spike;
        emit Trade(token, msg.sender, false, gross, tokensIn, fee, spike);
    }

    /// @dev `spikeShareBps` of what the part of a sale executed above the reference price fetches beyond
    /// that price. On the curve the price falls to `ref` once the token reserve reaches
    /// vToken * sqrt(spot / ref); whatever is sold past that point is not a spike.
    function _spikeShare(uint256 vQuote, uint256 vToken, uint256 ref, uint256 tokensIn, uint256 gross)
        internal
        view
        returns (uint256)
    {
        uint256 spot = Math.mulDiv(vQuote, 1e18, vToken);
        if (ref == 0 || spot <= ref) return 0;
        uint256 aboveRef = Math.mulDiv(vToken, Math.sqrt(Math.mulDiv(spot, 1e36, ref)), 1e18) - vToken;
        if (tokensIn > aboveRef) {
            tokensIn = aboveRef;
            (gross,,) = _sellOut(vQuote, vToken, aboveRef);
        }
        uint256 atRef = Math.mulDiv(tokensIn, ref, 1e18);
        return gross > atRef ? (gross - atRef) * spikeShareBps / BPS : 0;
    }

    /// @dev A spike share needs holders left to receive it.
    function _nobodyLeft(uint256 reserveAfter, uint256 vTokenAfter) internal pure returns (bool) {
        return reserveAfter == 0 || VIRTUAL_TOKENS - vTokenAfter <= DUST_TOKENS;
    }

    /// @dev Re-prices the curve so that its real reserve becomes `newReserve` without changing its shape:
    /// the virtual floor, the spot price and the reference price all scale by newReserve / reserve, so every
    /// outstanding token can still be sold back and together they fetch exactly `newReserve`.
    function _rescale(Meme storage m, uint256 newReserve) internal {
        uint256 reserve = m.vQuote - m.floor;
        uint256 newFloor = Math.mulDiv(m.floor, newReserve, reserve);
        m.ref = Math.mulDiv(m.ref, newReserve, reserve);
        m.floor = newFloor;
        m.vQuote = newFloor + newReserve;
    }

    function _updateRef(Meme storage m) internal {
        m.ref = _refNow(m, m.vQuote, m.vToken);
        m.refTime = uint64(block.timestamp);
    }

    function _resetRef(Meme storage m) internal {
        m.ref = Math.mulDiv(m.vQuote, 1e18, m.vToken);
        m.refTime = uint64(block.timestamp);
    }

    /// @dev The spot price has not moved since the last update, so the reference closes the gap linearly.
    function _refNow(Meme storage m, uint256 vQuote, uint256 vToken) internal view returns (uint256) {
        uint256 spot = Math.mulDiv(vQuote, 1e18, vToken);
        if (!m.settled) return spot; // settling resets the reference to the batch price
        uint256 elapsed = block.timestamp - m.refTime;
        if (elapsed >= REF_WINDOW) return spot;
        uint256 ref = m.ref;
        return spot > ref
            ? ref + Math.mulDiv(spot - ref, elapsed, REF_WINDOW)
            : ref - Math.mulDiv(ref - spot, elapsed, REF_WINDOW);
    }

    function _takeFee(Meme storage m, uint256 amount) internal returns (uint256 fee) {
        fee = amount * FEE_BPS / BPS;
        if (fee > 0) feesOf[m.creator][m.parent] += fee;
    }

    function _curveBuy(Meme storage m, uint256 quoteIn) internal returns (uint256 out) {
        (out, m.vQuote, m.vToken) = _buyOut(m.vQuote, m.vToken, quoteIn);
    }

    function _curveSell(Meme storage m, uint256 tokensIn) internal returns (uint256 out) {
        uint256 newVQuote;
        (out, newVQuote, m.vToken) = _sellOut(m.vQuote, m.vToken, tokensIn);
        // Unreachable: every circulating token was bought on this curve and rounding favours the reserve.
        if (newVQuote < m.floor) revert ReserveInvariant();
        m.vQuote = newVQuote;
    }

    /// @dev Constant product on virtual reserves, rounded in favour of the reserve.
    function _buyOut(uint256 vQuote, uint256 vToken, uint256 quoteIn)
        internal
        pure
        returns (uint256 out, uint256 newVQuote, uint256 newVToken)
    {
        newVQuote = vQuote + quoteIn;
        newVToken = Math.mulDiv(vQuote, vToken, newVQuote, Math.Rounding.Ceil);
        out = vToken - newVToken;
    }

    function _sellOut(uint256 vQuote, uint256 vToken, uint256 tokensIn)
        internal
        pure
        returns (uint256 out, uint256 newVQuote, uint256 newVToken)
    {
        newVToken = vToken + tokensIn;
        newVQuote = Math.mulDiv(vQuote, vToken, newVToken, Math.Rounding.Ceil);
        out = vQuote - newVQuote;
    }

    /// @dev Curve state as it will be once a finished-but-unsettled opening is settled.
    function _liveCurve(address token) internal view returns (uint256 vQuote, uint256 vToken) {
        Meme storage m = memes[token];
        (vQuote, vToken) = (m.vQuote, m.vToken);
        if (!m.settled) {
            if (block.timestamp < m.openUntil) revert StillOpening();
            if (m.batchQuote > 0) (, vQuote, vToken) = _buyOut(vQuote, vToken, m.batchQuote);
        }
    }

    function _raiseHeights(address start, uint256 h) internal {
        for (address t = start; t != address(0); t = memes[t].parent) {
            if (memes[t].height >= h) break;
            memes[t].height = uint8(h);
            ++h;
        }
    }

    function _union(uint256 id) internal view returns (Union storage) {
        if (id >= unions.length) revert UnknownUnion();
        return unions[id];
    }

    function _pullQuote(address token, address from, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        address parent = memes[token].parent;
        if (parent == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            MemeToken(parent).hubTransfer(from, address(this), amount);
        }
    }

    function _pushQuote(address token, address to, uint256 amount) internal {
        address parent = memes[token].parent;
        if (parent == address(0)) _sendEth(to, amount);
        else MemeToken(parent).transfer(to, amount);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
