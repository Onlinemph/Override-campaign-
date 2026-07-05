/**
 * ui/format.js — shared presentation helpers for the GM, audit, and player screens.
 * One source of truth for turning raw events/state into human-readable text, so the
 * screens can't drift. Attaches to window.Fmt. Functions that need entity names take the
 * campaign `truth` so they work on any screen (live GM state or a replayed audit frame).
 */
(function (global) {
  const LADDER = ['—', 'GHOST', 'SHADOW', 'CONTACT', 'LOCK'];

  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // ticks are 6 min each, 240/day; dawn (tick 60) = 06:00. Returns e.g. "D1 06:00".
  function clock(tick) {
    if (tick == null) return '';
    const day = Math.floor(tick / 240) + 1, tod = ((tick % 240) + 240) % 240;
    return `D${day} ${String(Math.floor(tod / 10)).padStart(2, '0')}:${String((tod % 10) * 6).padStart(2, '0')}`;
  }

  function ago(ticks) {
    const min = ticks * 6;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function up(id) { return String(id || '').toUpperCase(); }
  function fname(id, truth) { const f = truth && truth.formations[id]; return f ? f.name : id; }
  function facname(id, truth) { const f = truth && truth.facilities[id]; return f ? f.name : id; }

  function posText(p) {
    if (!p) return '';
    if (p.kind === 'ground') return `hex ${p.q},${p.r}`;
    if (p.kind === 'air') return `air ${p.gridQ},${p.gridR} ${p.band}`;
    if (p.kind === 'node') return p.nodeId;
    if (p.kind === 'lane') return `${p.laneId} ${p.progressAU.toFixed(1)}AU`;
    return '';
  }

  function cparts(cid) { const a = String(cid || '').split(':'); return { obs: a[1], tgt: a[2] }; }

  // plain-language status words
  function emconWord(e) {
    return { DARK: 'silent (EMCON dark)', PASSIVE: 'passive emissions', ACTIVE: 'active radar' }[e] || e;
  }
  function postureWord(p) {
    const w = { NONE: '', HIDE: 'hidden', DIGGING: 'digging in', DUG_IN: 'dug in',
                FORTIFIED: 'fortified' }[p];
    return w !== undefined ? w : (p ? String(p).toLowerCase() : '');
  }
  function rdyWord(r) { return r >= 8 ? 'fresh' : r >= 5 ? 'worn' : r >= 2 ? 'spent' : 'broken'; }
  function orderWords(kind) { return String(kind || '').toLowerCase().replace(/_/g, ' '); }
  // D-049: triggers in plain words, shared by the rules panel and the forces list
  function triggerWords(when, param) {
    switch (when) {
      case 'CONTACT_WITHIN': return `an enemy contact closes within ${param} hexes`;
      case 'DETECTED_SELF': return 'this unit realizes it has been spotted';
      case 'TICK_REACHED': return `the clock reaches tick ${param}`;
      case 'HEX_REACHED': return `it reaches hex ${param}`;
      case 'RDY_BELOW': return `readiness drops below ${param}`;
      case 'ALLY_ENGAGED': return `a friendly battle erupts within ${param} hexes`;
      case 'FUEL_BELOW': return `fuel drops below ${param}`;
      default: return `${when} ${param}`;
    }
  }

  function hexDist(a, b) {
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }
  // rough arrival tick for a ground move order: remaining hexes ÷ OMP hexes/hour
  function moveEtaTick(f, now) {
    if (now == null || !f.pos || !f.omp || !f.currentOrder || f.currentOrder.completed) return null;
    const wp = f.currentOrder.path || [];
    if (!wp.length) return null;
    let hexes = 0, cc = { q: f.pos.q, r: f.pos.r };
    for (const p of wp) { hexes += hexDist(cc, p); cc = p; }
    if (hexes <= 0) return null;
    return now + Math.ceil(hexes / f.omp * 10); // 10 ticks/hour
  }

  // a player's own formation as readable plain text (multi-line). `now` enables ETAs.
  function ownForce(f, now) {
    const where = f.flight && f.flight.airPos
      ? `airborne ${f.flight.airPos.q},${f.flight.airPos.r} ${f.flight.airPos.band}`
      : f.vessel && f.vessel.spacePos
      ? (f.vessel.spacePos.kind === 'node' ? f.vessel.spacePos.nodeId
         : `${f.vessel.spacePos.laneId} ${f.vessel.spacePos.progressAU.toFixed(1)} AU`)
      : (f.pos ? `hex ${f.pos.q},${f.pos.r}` : 'position unknown');
    const post = postureWord(f.posture);
    const head = [
      `${f.name} — ${where}`,
      `readiness ${f.rdy}/10 (${rdyWord(f.rdy)})`,
      emconWord(f.emcon) + (post ? `, ${post}` : ''),
      f.onNet ? 'linked to command net' : 'off-net — running on standing orders',
    ];
    if (f.sensor) head.push(`sensors ${f.sensor.passive}/${f.sensor.active} hex (passive/active)`);
    if (f.currentOrder) {
      const eta = moveEtaTick(f, now);
      head.push(`ordered to ${orderWords(f.currentOrder.kind)}` + (eta != null ? `, ETA ~${clock(eta)}` : ''));
    }
    let line = head.join(' · ');
    // why the order is waiting, straight from the engine (ext)
    if (f.currentOrder && f.currentOrder.stall) line += `\n   ⏳ ${f.currentOrder.stall}`;
    // D-053: pinned under shellfire — half pace until the barrage lifts
    if (f.suppressed) line += `\n   💥 suppressed — under shellfire, moving at half pace`;
    // D-049: the queued plan and standing rules, so the programming is visible
    if (f.plan && f.plan.length) {
      line += `\n   📋 then: ` + f.plan.map(s =>
        orderWords(s.kind) + (s.dest ? ` → ${s.dest.q},${s.dest.r}` : '')).join(' · ');
    }
    if (f.rules && f.rules.length) {
      line += `\n   ⚡ rules: ` + f.rules.map(r =>
        `${r.armed ? '' : '(spent) '}when ${triggerWords(r.when, r.param)} → ${orderWords(r.thenKind)}` +
        (r.targetHex ? ` @${r.targetHex.q},${r.targetHex.r}` : '')).join(' · ');
    }
    // Notable gear derived from the record sheets (ECM raises enemy detection TN; a
    // probe or mobile HQ is what lifts the sensor reach shown above).
    const GEAR = { ECM: 'ECM', ANGEL_ECM: 'Angel ECM', BEAGLE: 'active probe',
                   STEALTH: 'stealth armor', C3M: 'C3 master', HQ: 'mobile HQ', RECON: 'recon',
                   AA: 'anti-air (flak umbrella)', DECOY: 'decoys (reads one size bigger)' };
    const gear = [...new Set((f.units || []).flatMap(u =>
      (u.tags || []).filter(t => GEAR[t])))];
    if (gear.length) line += `\n   ⚙ gear: ${gear.map(t => GEAR[t]).join(', ')}`;
    if (f.flight) {
      const fl = f.flight;
      const ready = fl.turnaroundReadyTick != null && now != null && now < fl.turnaroundReadyTick
        ? ` · rearming, ready ${clock(fl.turnaroundReadyTick)}` : '';
      line += `\n   ✈ ${orderWords(fl.phase)} (${orderWords(fl.speed)})${ready} · fuel ${fl.fpMin} ` +
        `(joker ${fl.jokerFp} / bingo ${fl.bingoFp}) · fatigue ${fl.fatigueMax}` +
        (f.alertState ? ` · alert ${f.alertState}` : '');
    } else if (f.vessel) {
      const v = f.vessel;
      line += `\n   ⛁ ${v.fuelTons} t fuel (${v.burnDaysRemaining} burn-days)` +
        (v.drives || []).map(d => ` · jump drive ${d.chargePct}% charged, sail ${orderWords(d.sail)}`).join('');
    }
    // carrier ops: your own bays & rides (ext)
    if (f.mountedOn) line += `\n   🚢 embarked aboard ${f.mountedOn.name} — rides with the ship`;
    if (f.carrier) {
      line += `\n   🚢 carrier: ${f.carrier.aboard.length}/${f.carrier.bays} bays` +
        ` · ${f.carrier.crews} crew${f.carrier.crews === 1 ? '' : 's'}` +
        ` · ${f.carrier.avFuelTons} t av fuel` +
        (f.carrier.aboard.length ? ` · aboard: ${f.carrier.aboard.map(x => x.name).join(', ')}` : '');
    }
    return line;
  }

  function evTick(e) {
    if (e.tick != null) return e.tick;
    if (e.roll && e.roll.tick != null) return e.roll.tick;
    if (e.report && e.report.generatedTick != null) return e.report.generatedTick;
    if (e.contact && e.contact.lastConfirmedTick != null) return e.contact.lastConfirmedTick;
    return null;
  }

  // one readable contact line (operates on a projected view contact)
  function contactLine(c) {
    const at = esc(posText(c.estPos) || '?');
    const lvl = esc(c.levelName || LADDER[c.level] || '');
    const tail = [];
    if (c.estSizeClass) tail.push(esc(c.estSizeClass));
    if (c.estVector !== undefined && c.estVector !== null) tail.push(`hdg ${c.estVector}°`);
    if (c.estComposition) tail.push(esc(c.estComposition));
    const age = c.ageTicks ? ` <small>· ${ago(c.ageTicks)} old</small>` : '';
    return `<b>${lvl}</b> @ ${at}${c.posErrorHexes ? ' ±' + c.posErrorHexes : ''}` +
           (tail.length ? ' · ' + tail.join(' · ') : '') + age;
  }

  // the pending engagement as a plain-language briefing
  function engBriefing(e, truth) {
    const why = {
      SAME_HEX: 'both forces occupy the same hex',
      SCREEN: 'a screen line intercepted a mover',
      STRIKE: 'a strike order reached its target',
      AIR_INTERCEPT: 'an air interception merged',
      SPACE_INTERCEPT: 'a deep-space intercept',
    }[e.trigger] || e.trigger;
    const where = e.hex ? `hex ${e.hex.q},${e.hex.r}`
      : e.airPos ? `air ${e.airPos.gridQ},${e.airPos.gridR} ${e.airPos.band}`
      : (e.classification && e.classification.nodeId) || 'deep space';
    const atk = (e.attackerFormationIds || []).map(id => fname(id, truth)).join(', ') || up(e.attackerSideId);
    const def = (e.defenderFormationIds || []).map(id => fname(id, truth)).join(', ') || up(e.defenderSideId);
    const rows = [
      `<b>${up(e.attackerSideId)}</b> attacks at <b>${where}</b> — ${why}.`,
      `Attacker: ${esc(atk)} &nbsp;·&nbsp; Defender: ${esc(def)}`,
    ];
    if (e.classification) {
      const cl = e.classification;
      rows.push(`Geometry: <b>${cl.type}</b>${cl.marginBurnDays != null ? ` · ~${cl.marginBurnDays.toFixed(1)} burn-day margin` : ''}.`);
    }
    rows.push(`<span class="kv">Resolve evasion, or export the handoff, fight it on the table, and paste the result back in.</span>`);
    return rows.map(r => `<div style="margin:2px 0">${r}</div>`).join('');
  }

  // turn one logged event into { cls, icon, msg } — or null to drop it from the feed
  function humanize(e, truth) {
    const F = id => fname(id, truth);
    const FAC = id => facname(id, truth);
    switch (e.type) {
      case 'STEP_BEGAN': return { cls: 'head', msg: `${e.mode} watch` };
      case 'CAMPAIGN_INIT': return { cls: 'head', msg: 'campaign begins' };
      case 'CLOCK_ADVANCED': return null;
      case 'MOVE_PROGRESS': case 'FORMATION_BOOKKEEPING': case 'SPACE_SWEEP':
      case 'REPORT_QUEUED': case 'DAY_SCORED': case 'UNIT_STATE_CHANGED':
      case 'PILOT_STATE_CHANGED': return null;

      case 'DIE_ROLLED':
        return { cls: 'noise', icon: '🎲', msg: `${e.roll.result} — ${e.roll.purpose}` };

      case 'FORMATION_MOVED': {
        const how = { NORMAL: 'moves to', CAUTIOUS: 'eases to', FORCED: 'force-marches to',
                      SPRINT: 'sprints to' }[e.movedKind] || 'moves to';
        return { cls: '', icon: '→', msg: `${F(e.formationId)} ${how} ${e.to.q},${e.to.r}${e.onRoad ? ' (road)' : ''}` };
      }
      case 'CONTACT_UPGRADED': {
        const c = e.contact, lock = c.level >= 4, at = posText(c.estPos);
        return { cls: lock ? 'warn' : '', icon: lock ? '🔒' : '•',
          msg: `${up(c.observerSideId)} ${lock ? 'LOCKS' : 'gets ' + (LADDER[c.level] || 'L' + c.level) + ' on'} ${F(c.targetFormationId)}${at ? ` (${at})` : ''}` };
      }
      case 'CONTACT_FADED': { const p = cparts(e.contactId);
        return { cls: 'noise', icon: '·', msg: `${up(p.obs)}'s track on ${F(p.tgt)} fades to ${LADDER[e.level] || 'L' + e.level}` }; }
      case 'CONTACT_REMOVED': { const p = cparts(e.contactId);
        return { cls: 'noise', icon: '·', msg: `${up(p.obs)} loses the track on ${F(p.tgt)}` }; }
      case 'REPORT_DELIVERED': return null;
      case 'REPORT_EDITED': return { cls: 'warn', icon: '✎', msg: 'GM rewrote a report in transit' };
      case 'REPORTS_LOST': return { cls: 'noise', icon: '✕', msg: `${e.reportIds.length} report(s) lost — ${e.reason}` };

      case 'NET_CHANGED':
        return { cls: e.onNet ? '' : 'warn', icon: e.onNet ? '📡' : '⚠',
          msg: `${F(e.formationId)} ${e.onNet ? 'is back on-net' : 'drops off-net'}` };
      case 'EMCON_CHANGED': return { cls: '', icon: '·', msg: `${F(e.formationId)} goes EMCON ${e.emcon}` };
      case 'POSTURE_CHANGED': return { cls: 'noise', icon: '·', msg: `${F(e.formationId)} → ${e.posture}` };
      case 'HEXES_SCOUTED': return { cls: 'noise', icon: '·', msg: `${up(e.sideId)} scouts ${e.keys.length} hex(es)` };
      case 'FACILITY_SPOTTED': return { cls: '', icon: '📸', msg: `${up(e.sideId)} spots enemy installation ${FAC(e.facilityId)}` };
      case 'FACILITY_DAMAGED': return { cls: 'warn', icon: '💥', msg: `${FAC(e.facilityId)} hit by bombardment — ${e.damage}` };
      case 'FORMATION_SUPPRESSED': return { cls: 'noise', icon: '💥', msg: `${F(e.formationId)} pinned under shellfire (half pace)` };
      case 'SAT_PASS': return { cls: 'noise', icon: '🛰', msg: `satellite ${e.satelliteId} sweeps overhead` };
      case 'FORMATION_FIRED': return { cls: 'noise', icon: '✸', msg: `${F(e.formationId)} fires (gives away its hex)` };

      case 'ORDER_ISSUED': return { cls: 'noise', icon: '✎', msg: `${up(e.order.sideId)} orders ${F(e.order.formationId)}: ${e.order.kind}` };
      case 'ORDER_ACTIVATED': return null;
      case 'ORDER_COMPLETED': return { cls: 'noise', icon: '✓', msg: `${F(e.formationId)} completes its order` };
      case 'ORDER_SUPERSEDED': return null;
      case 'TRIGGER_FIRED': return { cls: '', icon: '⚙', msg: `${F(e.formationId)}'s conditional fires → ${e.newOrder.kind}` };

      case 'ENGAGEMENT_TRIGGERED': { const g = e.engagement;
        const a = (g.attackerFormationIds || []).map(F).join(', ');
        const d = (g.defenderFormationIds || []).map(F).join(', ');
        return { cls: 'big', icon: '⚔', msg: `BATTLE — ${a || up(g.attackerSideId)} vs ${d || up(g.defenderSideId)}${g.hex ? ` at ${g.hex.q},${g.hex.r}` : ''} (campaign frozen)` }; }
      case 'EVASION_RESOLVED':
        return { cls: e.success ? 'good' : 'warn', icon: e.success ? '↯' : '⚔',
          msg: e.success ? `defender slips away${e.slipTo ? ` to ${e.slipTo.q},${e.slipTo.r}` : ''}` : 'evasion fails — to the table' };
      case 'HANDOFF_EXPORTED': return { cls: 'big', icon: '⇄', msg: 'handoff exported — fight it on the table' };
      case 'BATTLE_RESULT_INGESTED': return { cls: 'big', icon: '⇄', msg: 'battle result ingested — campaign resumes' };
      case 'ROUT_STARTED': return { cls: 'bad', icon: '✦', msg: `${F(e.formationId)} routs (uncommandable a while)` };
      case 'FORMATION_DESTROYED': return { cls: 'bad', icon: '☠', msg: `${F(e.formationId)} destroyed — ${e.reason}` };
      case 'SALVAGE_CREATED': return { cls: 'noise', icon: '⚙', msg: 'salvage token left on the field' };
      case 'SALVAGE_RESOLVED': return { cls: '', icon: '⚙', msg: `salvage hauled in → ${e.outcome === 'UNIT' ? 'repairable unit' : 'spare parts'}` };

      case 'RDY_CHANGED': return { cls: 'noise', icon: '·', msg: `${F(e.formationId)} readiness ${e.delta > 0 ? '+' : ''}${e.delta} (${e.reason})` };
      case 'SUPPLY_CHANGED': return { cls: e.inSupply ? 'noise' : 'warn', icon: e.inSupply ? '·' : '⚠',
        msg: `${F(e.formationId)} ${e.inSupply ? 'is resupplied' : 'is cut off from supply'}` };
      case 'SP_CHANGED': return { cls: 'noise', icon: '·', msg: `${FAC(e.facilityId)} supply ${e.delta > 0 ? '+' : ''}${e.delta} (${e.reason})` };
      case 'BLOCKADE_STATE': return { cls: e.blockaded ? 'warn' : 'good', icon: '⚓',
        msg: `${up(e.sideId)} ${e.blockaded ? 'is blockaded — off-world supply cut' : 'breaks the blockade'}` };
      case 'TRANSPONDER_REVEALED': return { cls: 'warn', icon: '⚑', msg: `${F(e.formationId)}'s false flag is blown` };

      case 'VP_CHANGED': return { cls: '', icon: '★', msg: `${up(e.sideId)} ${e.delta > 0 ? '+' : ''}${e.delta} VP — ${e.reason}` };
      case 'OBJECTIVE_CONTROL': return { cls: '', icon: '★', msg: `${up(e.ownerSideId)} takes the objective at ${e.hexKey}` };
      case 'NODE_CONTROL': return { cls: '', icon: '★', msg: `${up(e.ownerSideId)} controls ${e.nodeId}` };
      case 'CAMPAIGN_ENDED': return { cls: 'big', icon: '🏁',
        msg: e.winnerSideId ? `CAMPAIGN OVER — ${up(e.winnerSideId)} wins (${e.reason})` : `CAMPAIGN OVER — draw (${e.reason})` };

      case 'AIR_LAUNCHED': return { cls: '', icon: '✈', msg: `${F(e.formationId)} launches` };
      case 'AIR_LANDED': return { cls: '', icon: '✈', msg: `${F(e.formationId)} lands at ${FAC(e.facilityId)}` };
      case 'AIR_MOVED': return { cls: 'noise', icon: '✈', msg: `${F(e.formationId)} flies to ${e.pos.gridQ},${e.pos.gridR} (−${e.fpPaid} FP)` };
      case 'AIR_PHASE': return { cls: 'noise', icon: '✈', msg: `${F(e.formationId)} → ${e.phase}` };
      case 'ALERT_CHANGED': return { cls: 'noise', icon: '✈', msg: `${F(e.formationId)} alert: ${e.alertState}` };
      case 'FUEL_THRESHOLD': return { cls: 'warn', icon: '⛽', msg: `${F(e.formationId)} hits ${e.threshold} fuel` };
      case 'FUEL_SPENT': case 'TONS_BURNED': case 'TONS_GAINED': case 'PILOT_FATIGUE':
      case 'TURNAROUND_STARTED': return null;

      case 'JUMP_EXECUTED': return { cls: '', icon: '✦', msg: `${F(e.formationId)} jumps to ${e.toNodeId}` };
      case 'MISJUMP': return { cls: 'bad', icon: '✦', msg: `${F(e.formationId)} MISJUMPS (rolled ${e.roll})` };
      case 'ARRIVED_AT_NODE': return { cls: '', icon: '⛢', msg: `${F(e.formationId)} arrives at ${e.pos.nodeId}` };
      case 'LANE_PROGRESS': return { cls: 'noise', icon: '·', msg: `${F(e.formationId)} ${e.pos.progressAU.toFixed(1)} AU out` };
      case 'NODE_SURVEYED': return { cls: 'noise', icon: '·', msg: `${up(e.sideId)} surveys ${e.nodeId}` };
      case 'EMISSION_OBSERVED': return { cls: 'noise', icon: '·', msg: `${up(e.sideId)} catches a distant flash` };

      case 'GM_NOTE': return { cls: '', icon: '✎', msg: e.text };
      default: {
        const id = e.formationId || (e.order && e.order.formationId);
        return { cls: 'noise', icon: '·',
          msg: e.type.toLowerCase().replace(/_/g, ' ') + (id ? ` — ${F(id)}` : '') };
      }
    }
  }

  global.Fmt = { LADDER, esc, clock, ago, up, fname, facname, posText, cparts, evTick,
                 contactLine, engBriefing, humanize,
                 emconWord, postureWord, rdyWord, orderWords, triggerWords, ownForce };
})(window);
