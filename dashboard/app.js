// Token Radar dashboard: board, filters, detail, farm. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, verdict: { deposit: 1000, alloc: 5, farmShare: 25, threshold: 25 } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtRatio(r) {
    if (!r.tvl_usd) return 'n/a';
    return (r.implied_value_usd / r.tvl_usd).toFixed(3) + 'x';
  }
  function catAdjOf(row) {
    var e = DATA.cat_adj && DATA.cat_adj[row.category];
    return e ? e.adj : 0;
  }
  // Same arithmetic as lib/model.ts.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var tvl = model.base_coeff * Math.pow(row.tvl_usd, model.tvl_exponent);
    var vif = Math.max(1, Math.round(tvl * Math.exp(catAdjOf(row)) * growthMult * maturity));
    return Math.max(1, Math.round(vif * row.launch_odds));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan (lib/model.ts).
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 75;
    return 60;
  }
  var L2 = ['base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'unichain', 'world chain', 'ink', 'abstract', 'soneium', 'taiko'];
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'about $0.03-15 of gas per transaction (quiet to busy)';
    if (c === 'solana') return 'about $0.001-0.02 of gas per transaction';
    if (c === 'hyperliquid l1') return 'about $0.01-0.10 of gas per transaction';
    if (L2.indexOf(c) >= 0) return 'about $0.01-0.30 of gas per transaction';
    if (['monad', 'plasma', 'katana', 'berachain', 'story', 'sei', 'sui', 'aptos', 'movement', 'megaeth'].indexOf(c) >= 0) return 'about $0.01-0.50 of gas per transaction (estimate: a newer chain, varies)';
    return 'about $0.01-0.50 of gas per transaction';
  }
  function gasRange(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return [0.03, 15];
    if (c === 'solana') return [0.001, 0.02];
    if (c === 'hyperliquid l1') return [0.01, 0.1];
    if (L2.indexOf(c) >= 0) return [0.01, 0.3];
    return [0.01, 0.5];
  }
  function fmtGas(n) {
    if (n >= 10) return String(Math.round(n));
    if (n >= 1) return String(Math.round(n * 10) / 10);
    return n.toFixed(2);
  }
  // Gas bill, per chain.
  function gasPlanFor(p, hold) {
    var weeks = Math.ceil(hold / 7);
    var counts = {};
    function add(chain, n) { counts[chain] = (counts[chain] || 0) + n; }
    var c0 = chainOf(p);
    add(c0, 1);
    if (p.chains && p.chains.length >= 5) add(p.chains[1], 1);
    else add(c0, 1);
    if (p.chains && p.chains.length >= 2) {
      add(c0, Math.ceil(weeks / 2));
      add(p.chains[1], Math.floor(weeks / 2));
    } else {
      add(c0, weeks);
    }
    var legs = Object.keys(counts).map(function (chain) {
      var range = gasRange(chain), txs = counts[chain];
      return { chain: chain, txs: txs, lo: range[0] * txs, hi: range[1] * txs };
    });
    var totalLo = 0, totalHi = 0, totalTxs = 0;
    legs.forEach(function (l) { totalLo += l.lo; totalHi += l.hi; totalTxs += l.txs; });
    return { legs: legs, totalLo: totalLo, totalHi: totalHi, totalTxs: totalTxs, weeks: weeks };
  }
  function gasTotalText(plan) {
    if (plan.legs.length === 1) {
      var l = plan.legs[0];
      return 'Gas total (est.): about $' + fmtGas(l.lo) + '-$' + fmtGas(l.hi) + ' across ' + l.txs + ' transactions on ' + l.chain;
    }
    var parts = plan.legs.map(function (l) { return l.chain + ' $' + fmtGas(l.lo) + '-$' + fmtGas(l.hi) + ' (' + l.txs + ' tx)'; }).join(' + ');
    return 'Gas total (est.): about $' + fmtGas(plan.totalLo) + '-$' + fmtGas(plan.totalHi) + ' — ' + parts;
  }
  function weeklyGasText(p) {
    var c0 = chainOf(p);
    if (!p.chains || p.chains.length < 2) return gasFor(c0).replace('per transaction', 'a week');
    var r0 = gasRange(c0), r1 = gasRange(p.chains[1]);
    return 'about $' + fmtGas(r0[0]) + '-$' + fmtGas(r0[1]) + ' a week on ' + c0 + ', about $' + fmtGas(r1[0]) + '-$' + fmtGas(r1[1]) + ' a week on ' + p.chains[1] + ' in alternate weeks (est.)';
  }
  // Active minutes: setup + weekly checks + log.
  function activeMinutesFor(setup, hold) {
    return 5 + setup + 10 * Math.ceil(hold / 7) + 10 + 5;
  }
  function fmtDuration(minutes) {
    if (minutes < 60) return minutes + 'm';
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }
  // Step 2 varies: second chain, split, top-up, repeat.
  function actionVariant(p, capital, chain, age) {
    if (p.chains && p.chains.length >= 5) {
      return 'Then repeat the same deposit once on ' + p.chains[1] + ', so the position exists on two chains and the activity is not tied to one of them.';
    }
    if (age !== null && age !== undefined && age < 180) {
      return 'Deposit half the capital now and the other half after two weeks, so the activity spans two windows instead of one day.';
    }
    if (p.tvl_usd >= 1e9) {
      return 'Split the deposit across two vaults or pools inside ' + p.name + ', so no single position holds it all.';
    }
    if (age !== null && age !== undefined && age >= 365) {
      return 'After 30 days, add a second deposit of $' + capital + " only if the protocol's own page shows the first position is still active.";
    }
    return 'Do the same action once more on a different day in the same week, so the activity is not a single transaction.';
  }
  function setupMinutesFor(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('payment') >= 0 || c.indexOf('governance') >= 0 || c.indexOf('stable') >= 0) return 10;
    if (c === 'chain' || c.indexOf('rwa') >= 0 || c.indexOf('cedefi') >= 0) return 20;
    return 15;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and check where the curator allocates it and what fee it takes.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and check the strategies it routes to and the fee it takes.';
    if (c === 'chain') return 'Bridge $' + capital + " of the chain's native asset to " + chain + ', keep extra gas aside, and use its main app once.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small hedge, use no leverage, and check the liquidation price first.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ', check its minimum amount first, and confirm how the yield is paid.';
    if (c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity through ' + name + ' on ' + chain + ' and read its range and fee notes first.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount once and repay it, and check the health factor before you leave it.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and read the fee and impermanent-loss notes first.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' yield vault on ' + chain + ' and check its strategy and fee.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small hedge, use no leverage, and check the liquidation price first.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one market position.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and check the cover period and the claim terms.';
    if (c.indexOf('cedefi') >= 0) return 'Open the CeFi-linked account ' + name + ' describes, then deposit and withdraw a small amount once to test it.';
    if (c.indexOf('payment') >= 0) return 'Send a small payment of $' + capital + ' through ' + name + ' on ' + chain + ' and confirm the recipient got it.';
    if (c.indexOf('governance') >= 0) return 'Take part in ' + name + "'s governance on " + chain + ' and cast one vote.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and check the peg first.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' farm pool on ' + chain + ' and check the reward terms first.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app once.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  // Weekly action, by category and chains.
  function weeklyActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var second = (p.chains && p.chains.length >= 2)
      ? ' Alternate the weekly action between ' + chain + ' and ' + p.chains[1] + ', so both chains show activity.'
      : '';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) {
      return 'Each week, check the health factor and the borrow rate; repay a small slice of the borrow and re-supply it, so the position stays active without raising the loan.' + second;
    }
    if (c.indexOf('index') >= 0) {
      return "Each week, check the index's composition; rebalance only what the protocol itself rebalanced." + second;
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return "Each week, check the pool's range and the fees earned; collect the fees once and re-add them to the same pool if the range still holds." + second;
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) {
      return 'Each week, check the vault\'s strategy and fee; compound only what the vault itself shows as claimable, and leave the principal in place.' + second;
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Each week, check the yield payout and the asset\'s backing note; leave the payout in the position unless the protocol\'s own page says to claim it.' + second;
    }
    if (c === 'chain') {
      return 'Each week, use the chain\'s main app once — a swap, a vote or a small transfer — and keep enough of the native asset aside for gas.' + second;
    }
    if (c.indexOf('basis') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Each week, check the hedge\'s liquidation price and funding; close and reopen the small hedge only if the price moved close to it.' + second;
    }
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) {
      return 'Each week, check the staking receipt\'s value and the validator set; restake only the rewards the protocol shows as claimable.' + second;
    }
    if (c.indexOf('governance') >= 0) {
      return 'Each week, read the active proposals and vote on one; a vote counts as the week\'s qualifying action.' + second;
    }
    if (c.indexOf('payment') >= 0 || c.indexOf('crypto card') >= 0) {
      return 'Each week, send one small payment through ' + p.name + ' on ' + chain + ' and confirm the recipient got it.' + second;
    }
    if (c.indexOf('stable') >= 0) {
      return 'Each week, check the peg and the redemption terms first; mint or redeem a small amount only if the peg moved off its band.' + second;
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Each week, place one small market position and settle the previous week\'s one before opening the next.' + second;
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Each week, check the cover\'s expiry and claim terms; add cover only when the current period is about to end.' + second;
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Each week, bridge a small amount of USDC to ' + chain + ' through ' + p.name + ' and use it in its app once.' + second;
    }
    if (c.indexOf('cedefi') >= 0) {
      return 'Each week, check the CeFi-linked account\'s balance and withdraw a small amount once to confirm it still moves.' + second;
    }
    return 'Each week, make one qualifying action the protocol itself counts — a deposit, a borrow, a swap or a vote — and vary which one it is from week to week.' + second;
  }
  // Hold check, by category.
  function holdCheckFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) {
      return 'If the health factor falls below the level the protocol\'s own page calls safe, repay part of the borrow before the hold ends; otherwise leave the position alone.';
    }
    if (c.indexOf('index') >= 0) {
      return 'If the index\'s composition changes, follow the protocol\'s own rebalance instead of holding the old mix.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return 'If the price leaves the pool\'s range, withdraw and re-enter at the new range instead of holding a dead position.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) {
      return 'If the curator changes the allocation or raises the fee, compare the new terms with the first month\'s before deciding to stay.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'If a yield payout is missed or the backing note changes, pause and re-read the protocol\'s own terms before extending the hold.';
    }
    if (c === 'chain') {
      return 'If the chain\'s gas spikes for a whole week, skip that week\'s action rather than paying the spike; the hold still counts.';
    }
    if (c.indexOf('basis') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'If the hedge\'s liquidation price comes within 10% of the market price, close the hedge and wait; do not add margin to chase it.';
    }
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) {
      return 'If the validator set changes or the receipt token slips, unstake the receipt and re-stake through a different validator the protocol lists.';
    }
    return 'If the protocol\'s TVL falls by more than a third during the hold, re-read its own page before adding anything more.';
  }
  // Points page and re-check cadence.
  function pointsNoteFor(p, age) {
    var c = (p.category || '').toLowerCase();
    var surface = 'the rewards section of the protocol\'s own app';
    if (c.indexOf('governance') >= 0) surface = 'the governance forum and the rewards page';
    else if (c === 'chain') surface = 'the chain\'s ecosystem and rewards pages';
    else if (c.indexOf('rwa') >= 0) surface = 'the protocol\'s investor page and its rewards page';
    else if (c.indexOf('payment') >= 0 || c.indexOf('crypto card') >= 0) surface = 'the payments app\'s rewards section';
    var cadence = (age !== null && age !== undefined && age < 180)
      ? 'Check again after 30 days, while the programme is still new.'
      : (age !== null && age !== undefined && age >= 365)
        ? 'Check once, then again only if the protocol announces a change.'
        : 'Check once during the hold and once before it ends.';
    return 'For a ' + (p.category || 'pre-token') + ' protocol, look first at ' + surface + '. ' + cadence;
  }
  // Log contents, by position type.
  function logNoteFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    if (p.chains && p.chains.length >= 2) {
      return 'Log each chain separately, with the wallet, the dates and every transaction hash per chain, so a position on ' + p.chains[1] + ' can be unwound without touching ' + chain + '.';
    }
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) {
      return 'Log the health factor at entry and each week, with every transaction hash, so a borrow can be repaid before it is liquidated.';
    }
    if (c.indexOf('index') >= 0) {
      return 'Log the index\'s composition at entry and each week, with every transaction hash.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return 'Log the pool, the range and the fees collected each week, with every transaction hash.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) {
      return 'Log the vault, the allocation at entry and every transaction hash, so a withdrawal follows the log instead of memory.';
    }
    if (c.indexOf('basis') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Log the entry price, the liquidation price and every transaction hash, so the hedge can be closed at the logged price.';
    }
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) {
      return 'Log the receipt token, the validator and every transaction hash.';
    }
    return 'Note the exit order in the same log — withdraw first, then close the wallet\'s approvals — so unwinding follows the log instead of memory.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var setup = setupMinutesFor(p.category);
    var plan = gasPlanFor(p, hold);
    var active = activeMinutesFor(setup, hold);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Keep at least 0.005 ETH in the wallet: Starknet required at least 0.005 ETH to qualify, and Arbitrum stripped points from wallets under 0.005 ETH that had touched at most one contract. Farm with this one wallet only: LayerZero flagged 803,093 addresses as sybil in 2024.', cost: gas.replace('per transaction', 'for the first transaction on ' + chain), time: '5 minutes' },
      { text: actionFor(p, capital, chain) + ' ' + actionVariant(p, capital, chain, p.age_days), cost: '$' + capital + ' of capital and ' + gas + '. ' + gasTotalText(plan) + '. Minimum viable capital (est.): $' + (capital + Math.ceil(plan.totalHi)) + ' (capital plus gas high end)', time: setup + ' minutes to set up' },
      { text: weeklyActionFor(p, chain) + ' Spread the work across at least three distinct months: Arbitrum paid more for activity in 2, 6 and 9 distinct months, and Starknet required at least 3 months.', cost: weeklyGasText(p), time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot window. ' + holdCheckFor(p) + ' Leave the deposit in place: zkSync weighted rewards by time-weighted balance, so moving funds in and out counts for less than holding them.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page to see whether it runs a programme; if it does, follow only the link that page publishes, and never pay a fee to claim. Points sometimes never convert: in 2026 StandX cancelled its token and Zeta withdrew its migration, so treat points as a hope, not a promise. " + pointsNoteFor(p, p.age_days), cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it safely. ' + logNoteFor(p, chain) + ' The whole plan takes about ' + fmtDuration(active) + ' of active time across ' + hold + ' days: ' + setup + ' minutes to set up, ' + plan.weeks + ' weekly checks of 10 minutes, 10 minutes to check for a programme, 5 to log.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // Farm verdict, stated scenario (sliders): the drop allocates alloc% of
  // implied, split by farmShare% of TVL; costs are gas + capital at 5%/yr.
  // FARM clears threshold $/h.
  var VDEFS = [
    ['deposit', 'Deposit', 50, 5000, 50],
    ['alloc', 'Drop share', 1, 20, 1],
    ['farmShare', 'TVL farming', 5, 50, 5],
    ['threshold', 'FARM at', 5, 50, 5]
  ];
  function vfmt(key, val) {
    if (key === 'deposit' || key === 'threshold') return '$' + val + (key === 'threshold' ? '/h' : '');
    return val + '%';
  }
  function verdictFor(r) {
    var v = state.verdict;
    var expected = r.implied_value_usd * v.alloc / 100 * Math.min(1, v.deposit / Math.max(1, r.tvl_usd * v.farmShare / 100));
    var hold = holdDaysFor(r.age_days);
    var plan = gasPlanFor(r, hold);
    var capCost = v.deposit * 0.05 * hold / 365;
    var activeH = activeMinutesFor(setupMinutesFor(r.category), hold) / 60;
    var net = expected - plan.totalHi - capCost;
    var perHour = net / activeH;
    return { label: perHour >= v.threshold ? 'FARM' : perHour >= 0 ? 'MARGINAL' : 'SKIP', perHour: perHour, net: net };
  }
  function verdictCounts() {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { c[verdictFor(r).label]++; });
    return c;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist')) state.watchlist = params.get('watchlist') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'ratio') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else if (key === 'verdict') { av = verdictFor(a).perHour; bv = verdictFor(b).perHour; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'mark-ring' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var kpis = [
      ['92%', 'walk-forward 70/30'],
      ['106%', 'leave-one-out error'],
      ['R\u00B2 0.19', 'in-sample error 82%'],
      ['79%', 'in P10-P90 band'],
      ['0.180', 'odds Brier (base 0.25)'],
      ['40 / 40', 'watchlist']
    ].map(function (kv) {
      return el('div', { class: 'kpi' }, el('b', { text: kv[0] }), el('span', { text: kv[1] }));
    });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model claim, not a promise, and not a prediction of issuance.' })
      ),
      el('div', { class: 'kpis lede-kpis' }, kpis)
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlist ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watchlist' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'watch', text: 'WATCH' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num ratio', text: fmtRatio(r) }),
        el('td', { class: 'num', text: (r.launch_odds * 100).toFixed(1) + '%' }),
        el('td', null, (function () { var vd = verdictFor(r); return el('div', { class: 'name' }, el('b', { class: vd.label === 'FARM' ? 'pos' : vd.label === 'SKIP' ? 'neg' : '', text: vd.label }), el('span', { class: 'sub', text: (vd.perHour >= 0 ? '+' : '') + '$' + vd.perHour.toFixed(1) + '/h' })); })()),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest first. Select a row for its plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied'),
            sortHeader('ratio', 'Implied/TVL'),
            sortHeader('odds', 'Odds'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these already trade; market cap is a fact, not a model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // Charts, from the same rows.
  function chartsSection() {
    var ratios = DATA.rows.map(function (r) { return r.implied_value_usd / r.tvl_usd; });
    var sorted = ratios.slice().sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)];
    var lo = sorted[0], hi = sorted[sorted.length - 1];
    var bins = 10, counts = [];
    for (var i = 0; i < bins; i++) counts.push(0);
    var llo = Math.log10(lo), lhi = Math.log10(hi);
    ratios.forEach(function (r) {
      var b = Math.min(bins - 1, Math.floor((Math.log10(r) - llo) / (lhi - llo) * bins));
      counts[b]++;
    });
    var maxC = Math.max.apply(null, counts);
    var W = 640, H = 170, pad = 36;
    var bw = (W - pad * 2) / bins, hist = '';
    counts.forEach(function (c, j) {
      var h = c / maxC * (H - 56);
      var x = pad + j * bw + 2, y = H - 22 - h;
      hist += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="#0c6b4d"><title>' + c + ' rows</title></rect>';
    });
    hist += '<text class="axis" x="' + pad + '" y="' + (H - 6) + '">' + lo.toFixed(3) + 'x</text>';
    hist += '<text class="axis" x="' + (W / 2 - 30) + '" y="' + (H - 6) + '">median ' + med.toFixed(3) + 'x</text>';
    hist += '<text class="axis" x="' + (W - pad - 34) + '" y="' + (H - 6) + '">' + hi.toFixed(3) + 'x</text>';
    hist += '<text class="axis" x="' + pad + '" y="14">most rows: ' + maxC + '</text>';
    var histSvg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Histogram of implied value over TVL">' + hist + '</svg>';

    var tvls = DATA.rows.map(function (r) { return Math.log10(r.tvl_usd); });
    var imps = DATA.rows.map(function (r) { return Math.log10(r.implied_value_usd); });
    var x0 = Math.min.apply(null, tvls), x1 = Math.max.apply(null, tvls);
    var y0 = Math.min.apply(null, imps), y1 = Math.max.apply(null, imps);
    var SW = 640, SH = 260, sp = 44;
    function sx(v) { return sp + (v - x0) / (x1 - x0) * (SW - sp * 2); }
    function sy(v) { return SH - sp - (v - y0) / (y1 - y0) * (SH - sp * 2); }
    var ref = '<line x1="' + sx(x0).toFixed(1) + '" y1="' + sy(Math.log10(0.214) + x0).toFixed(1) + '" x2="' + sx(x1).toFixed(1) + '" y2="' + sy(Math.log10(0.214) + x1).toFixed(1) + '" stroke="#96690a" stroke-dasharray="5 4" stroke-width="1.5"/>';
    var dots = '';
    DATA.rows.forEach(function (r) {
      dots += '<circle cx="' + sx(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + sy(Math.log10(r.implied_value_usd)).toFixed(1) + '" r="3" fill="' + (r.watchlist ? '#0c6b4d' : '#96690a') + '" fill-opacity="0.75"><title>' + r.name + ': TVL $' + r.tvl_usd.toLocaleString('en-US') + ', implied $' + r.implied_value_usd.toLocaleString('en-US') + '</title></circle>';
    });
    var axes = '<text class="axis" x="' + sp + '" y="16">implied value (log scale)</text>'
      + '<text class="axis" x="' + (SW - sp - 90) + '" y="' + (SH - 8) + '">TVL (log scale)</text>'
      + '<text class="axis" x="' + sp + '" y="' + (SH - 26) + '">$' + Math.round(Math.pow(10, x0) / 1e6) + 'M</text>'
      + '<text class="axis" x="' + (SW - sp - 60) + '" y="' + (SH - 26) + '">$' + (Math.pow(10, x1) / 1e9).toFixed(1) + 'B</text>';
    var scatSvg = '<svg viewBox="0 0 ' + SW + ' ' + SH + '" role="img" aria-label="Scatter of TVL against implied value">' + ref + dots + axes + '</svg>';

    return el('section', { class: 'panel charts' },
      el('h2', { text: 'What the board looks like' }),
      el('figure', null,
        el('h3', { text: 'Implied value over TVL' }),
        el('div', { html: histSvg }),
        el('p', { class: 'sub', text: '178 rows, log-spaced bins. Median ' + med.toFixed(3) + 'x, ' + lo.toFixed(3) + 'x to ' + hi.toFixed(3) + 'x. Top rows near 0.01x, small rows reach 0.42x: the 0.70 slope prices the largest lowest.' })
      ),
      el('figure', null,
        el('h3', { text: 'TVL against implied value' }),
        el('div', { html: scatSvg }),
        el('p', { class: 'sub', text: 'Each dot is one row, green for the watchlist, amber for the early radar. The dashed line is the priced protocols\u2019 median ratio, 0.214x. The cloud bends below it at the top end: the fitted 0.70 slope at work.' })
      )
    );
  }

  // Held-out evidence above the board, so the board screenshot carries it.
  // KPI tiles in the lede; integrity folds in here.
  function evidenceStrip() {
    var heldOut = [
      ['Entry formula', '92.4%', '106.4%', 'adopted'],
      ['TVL only', '90.3%', '118.7%', 'baseline'],
      ['+ growth + age, fitted', '448.1%', '144.2%', 'dropped'],
      ['+ category, fitted', '806.2%', '144.1%', 'shrunk only']
    ].map(function (r) {
      return el('tr', null, r.map(function (c, i) {
        return el('td', (i === 1 || i === 2) ? { class: 'num', text: c } : { text: c });
      }));
    });
    var farmOk = DATA.rows.every(function (r) { return farmSteps(r).every(function (s) { return s.indexOf(' Cost: ') >= 0 && s.indexOf(' Time: ') >= 0; }); });
    var wl = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    var orderOk = DATA.rows.every(function (r, i) { return r.rank === i + 1 && (i === 0 || r.implied_value_usd <= DATA.rows[i - 1].implied_value_usd); });
    var a = DATA.audit;
    return el('section', { class: 'panel evidence' },
      el('h2', { text: 'How the model was tested' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Median error, held out; every term tested twice.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Model' }),
            el('th', { scope: 'col', text: 'Walk-forward 70/30' }),
            el('th', { scope: 'col', text: 'Leave-one-category-out' }),
            el('th', { scope: 'col', text: 'Kept?' }))),
          el('tbody', null, heldOut)
        )
      ),
      el('p', { class: 'sub', text: 'Slope 1.0: same ranking (Spearman 0.95). Top 3 hold 74.5% of watchlist TVL.' }),
      el('div', { class: 'integrity' },
        el('span', { text: 'Watchlist ' + wl + ' / ' + DATA.watchlist_size }),
        el('span', { text: 'Ranks in order: ' + (orderOk ? 'yes' : 'NO') }),
        el('span', { text: 'Farm steps: Cost/Time ' + (farmOk ? 'yes' : 'NO') }),
        el('span', { text: 'Snapshot: ' + a.ranked + '+' + a.live + '+' + a.excluded + '+' + a.above_floor + '=' + a.total })
      ),
      verdictBar()
    );
  }

  function verdictBar() {
    var counts = verdictCounts();
    var sliders = VDEFS.map(function (d) {
      var key = d[0], label = d[1], min = d[2], max = d[3], step = d[4];
      var val = state.verdict[key];
      var lab = el('span', { text: label + ' ' + vfmt(key, val) });
      var inp = el('input', { type: 'range', min: min, max: max, step: step, value: val, 'aria-label': label });
      inp.addEventListener('input', function () { state.verdict[key] = +inp.value; lab.textContent = label + ' ' + vfmt(key, inp.value); });
      inp.addEventListener('change', function () { render(); });
      return el('label', { class: 'vfield' }, lab, inp);
    });
    return el('div', { class: 'vbar' },
      el('span', { class: 'vbar-title', text: 'Verdict scenario:' }),
      sliders,
      el('span', { class: 'sub', text: 'FARM ' + counts.FARM + ' · MARGINAL ' + counts.MARGINAL + ' · SKIP ' + counts.SKIP + ' · cap 5%/yr' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var catRows = Object.keys(DATA.cat_adj || {}).sort().map(function (c) {
      var e = DATA.cat_adj[c];
      return el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: String(e.n) }),
        el('td', { class: 'num', text: (e.adj > 0 ? '+' : '') + e.adj.toFixed(3) }),
        el('td', { class: 'num', text: 'x' + Math.exp(e.adj).toFixed(3) })
      );
    });
    var oddsRows = (DATA.odds_buckets || []).map(function (b) {
      return el('tr', null,
        el('td', { text: b.bucket }),
        el('td', { class: 'num', text: String(b.n) }),
        el('td', { class: 'num', text: b.pct + '%' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone.' }),
      el('div', { class: 'formula' },
        'implied = round( exp(3.7148) x TVL^' + m.tvl_exponent + ' x exp(cat_adj) x (0.85 + 0.30 x min(age_days, 1095) / 1095) x (1 + 0.15 x clip(change_7d, -30, +30) / 100) x launch_odds )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since first listing; unknown age uses 365 days. Category adjustments are shrunk by n/(n+5), capped at +/-0.7, only for categories with at least 5 priced peers. Launch odds multiply the value in: the value if issued, weighted by peer issuance.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Category adjustments. Other categories score 0.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Teacher n' }), el('th', { scope: 'col', text: 'cat_adj' }), el('th', { scope: 'col', text: 'Multiplier' }))),
          el('tbody', null, catRows)
        )
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Launch odds by age band: share of the cohort with a token.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age band' }), el('th', { scope: 'col', text: 'Cohort n' }), el('th', { scope: 'col', text: 'Have a token' }))),
          el('tbody', null, oddsRows)
        )
      ),
      el('p', { class: 'note', text: 'Uncertainty: a P10-P90 band from the 128 priced teachers\' log residuals. The band is wide because the fit is weak (R^2 0.19). Odds are a cohort rate, never a launch date.' }),
      el('p', { class: 'note', text: 'Literature: slope 0.70 is close to the long-run TVL elasticity of ETH, 0.8 (Frontiers 2026). Wrapped products double-count TVL (Luo 2024). Revenue multiples need fee data this snapshot lacks (Xu 2022); TVL does not predict future values (Metelski & Sobieraj 2022). Gas uses 2026 medians (FinTech 2026).' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var catEntry = DATA.cat_adj && DATA.cat_adj[row.category];
    var catNote = catEntry ? ('cat_adj ' + (catEntry.adj > 0 ? '+' : '') + catEntry.adj.toFixed(3) + ' from ' + catEntry.n + ' priced peers, shrunk and capped') : 'no adjustment, <5 priced peers';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : ' - early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, term by term' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Equation for this row' }), el('b', { text: fmtUsd(row.tvl_component) + ' x ' + row.cat_multiplier.toFixed(3) + ' x ' + row.growth_multiplier.toFixed(3) + ' x ' + row.maturity_multiplier.toFixed(3) + ' x ' + row.launch_odds.toFixed(3) + ' = ' + fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'TVL term' }), el('b', { text: fmtUsd(row.tvl_component) })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { text: 'x' + row.cat_multiplier.toFixed(3) + ' (' + catNote + ')' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) + ' -> x' + row.growth_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) + ' -> x' + row.maturity_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied value (odds-weighted)' }), el('b', { text: fmtUsd(row.implied_value_usd) + ' (' + fmtRatio(row) + ' of TVL)' })),
        el('div', null, el('span', { text: 'Peers with a token' }), el('b', { text: row.peer_issued_pct === null ? 'n/a' : row.peer_issued_pct + '% of ' + row.peer_n + ' peers (shown, not used)' })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { text: (row.launch_odds * 100).toFixed(1) + '% of ' + row.launch_odds_n + ' peers in this age x category cell' })),
        el('div', null, el('span', { text: 'Value if launched' }), el('b', { text: fmtUsd(row.value_if_launches_usd) + ' (before the odds)' })),
        el('div', null, el('span', { text: 'P10-P90 interval' }), el('b', { text: fmtUsd(row.value_lo) + ' - ' + fmtUsd(row.value_hi) + ' (teachers\' residuals)' }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board.') + ' Odds multiply the value in. An estimate, not a price, and not a prediction of issuance.' })
    ));
    var plan = gasPlanFor(row, holdDaysFor(row.age_days));
    var active = activeMinutesFor(setupMinutesFor(row.category), holdDaysFor(row.age_days));
    var vd = verdictFor(row);
    var costRows = [
      ['Verdict', vd.label + ', net ' + (vd.net >= 0 ? '+' : '') + '$' + vd.net.toFixed(0) + ' (' + (vd.perHour >= 0 ? '+' : '') + '$' + vd.perHour.toFixed(1) + '/h)'],
      ['Capital in position', '$' + capitalFor(row)],
      ['Gas total (est.)', '$' + fmtGas(plan.totalLo) + ' - $' + fmtGas(plan.totalHi) + ' across ' + plan.totalTxs + ' transactions'],
      ['Minimum viable capital', '$' + capitalFor(row) + ' capital + up to $' + Math.ceil(plan.totalHi) + ' gas = $' + row.min_capital_usd],
      ['Gas per chain', plan.legs.map(function (l) { return l.chain + ' $' + fmtGas(l.lo) + '-$' + fmtGas(l.hi) + ' (' + l.txs + ' tx)'; }).join('; ')],
      ['Active time', 'about ' + fmtDuration(active) + ' across ' + holdDaysFor(row.age_days) + ' days (' + plan.weeks + ' weekly checks)'],
      ['Gas per active hour', '$' + (plan.totalHi / (active / 60)).toFixed(2) + ' / hour at the gas high end'],
      ['Hold', holdDaysFor(row.age_days) + ' days']
    ].map(function (kv) {
      return el('tr', null, el('td', { text: kv[0] }), el('td', { class: 'num', text: kv[1] }));
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Cost breakdown' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'From this row\u2019s own chains, hold and weekly count.' }),
          el('tbody', null, costRows)
        )
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function auditSection() {
    var a = DATA.audit;
    function block(title, list) {
      return el('details', null,
        el('summary', { text: title }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Reason' }))),
            el('tbody', null, list.map(function (x) {
              return el('tr', null, el('td', { text: x.name }), el('td', { text: x.category || 'Other' }), el('td', { class: 'num', text: fmtUsd(x.tvl_usd) }), el('td', { text: x.reason }));
            }))
          )
        )
      );
    }
    return el('section', { class: 'panel sect' },
      el('h2', { text: 'Every protocol accounted for' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + a.total + ' protocols: ' + a.ranked + ' ranked, ' + a.live + ' live, ' + a.excluded + ' excluded, ' + a.above_floor + ' above the floor, not on the watchlist.' }),
      block('Excluded by the watchlist rule (' + a.excluded + ')', a.excluded_rows),
      block('Above the floor, not watchlisted (' + a.above_floor + ')', a.above_rows)
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(evidenceStrip());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') { shell.appendChild(chartsSection()); shell.appendChild(modelPanel()); shell.appendChild(auditSection()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
