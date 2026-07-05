/**
 * campaign/schema.ts — the authoring vocabulary (runtime enum sets mirroring the engine
 * union types) plus a validator that turns a parsed campaign JSON into a list of
 * human-readable problems. Shared by the loader (fails fast with friendly errors) and,
 * later, the campaign-editor UI (field pickers + live validation).
 */

export const TERRAINS = ['CLEAR', 'WOODS', 'ROUGH', 'HILLS', 'MOUNTAIN', 'WATER', 'SWAMP', 'URBAN'] as const;
export const INFRA = ['ROAD', 'RAIL', 'BRIDGE', 'TOWN', 'CITY', 'FORT', 'SPACEPORT', 'FACTORY',
  'HPG', 'DEPOT', 'SENSOR_STATION', 'AIRSTRIP', 'COMM_RELAY'] as const;
export const NODE_TYPES = ['JUMP_ZENITH', 'JUMP_NADIR', 'PIRATE_POINT', 'PLANET', 'MOON',
  'GAS_GIANT', 'BELT_SECTOR', 'STATION_RECHARGE', 'STATION_OTHER', 'SHIPYARD'] as const;
export const UNIT_CLASSES = ['MECH', 'VEHICLE', 'INFANTRY', 'BA', 'PROTO', 'VTOL', 'CONV_FIGHTER',
  'ASF', 'SMALL_CRAFT', 'DROPSHIP', 'JUMPSHIP', 'WARSHIP', 'SUPPORT', 'NAVAL'] as const;
export const EMCONS = ['DARK', 'PASSIVE', 'ACTIVE'] as const;
export const POSTURES = ['NONE', 'HIDE', 'DUG_IN', 'DIGGING', 'FORTIFIED'] as const;
export const ALERTS = ['ALERT5', 'ALERT15', 'ALERT60', 'STAND_DOWN'] as const;
export const DAMAGE_STATES = ['OK', 'DAMAGED', 'CRIPPLED', 'DESTROYED', 'SALVAGE'] as const;
export const AMMO_STATES = ['FULL', 'PARTIAL', 'DRY'] as const;
export const WEATHERS = ['CLEAR', 'RAIN', 'STORM'] as const;
export const SAIL_STATES = ['STOWED', 'DEPLOYED', 'DESTROYED'] as const;
export const KF_DAMAGE = ['NONE', 'MINOR', 'MAJOR', 'DEAD'] as const;
export const CAPITAL_WEAPON_NAMES = [
  'BARRACUDA', 'KILLER_WHALE', 'WHITE_SHARK', 'MASS_DRIVER_HEAVY', 'MASS_DRIVER_LIGHT', 'MASS_DRIVER_MEDIUM', 'NAC_10', 'NAC_20', 'NAC_25', 'NAC_30', 'NAC_35', 'NAC_40',
  'NGAUSS_HEAVY', 'NGAUSS_LIGHT', 'NGAUSS_MEDIUM', 'NL35', 'NL45', 'NL55', 'NPPC_HEAVY', 'NPPC_LIGHT', 'NPPC_MEDIUM', 'SCC_HEAVY', 'SCC_LIGHT', 'SCC_MEDIUM',
  'SCL_1', 'SCL_2', 'SCL_3', 'MANTA_RAY', 'PIRANHA', 'STINGRAY', 'SWORDFISH',
] as const;
export const MARKER_KINDS = ['DOWNED_CREW', 'MINEFIELD', 'SENTINEL_DRONE', 'FUEL_CACHE', 'WRECK'] as const;
export const GROUND_ORDERS = ['MOVE', 'FORCED_MARCH', 'MOVE_CAUTIOUS', 'HIDE', 'DIG_IN', 'PATROL',
  'SCREEN', 'STRIKE', 'SHADOW', 'RESUPPLY', 'REST', 'REARM', 'REPAIR',
  'EMBARK', 'DISEMBARK',
  'FIRE', 'LAY_MINES', 'BREACH', 'DEMOLISH', 'BUILD_BRIDGE'] as const;
export const AIR_ORDERS = ['CAP', 'ORBITAL_STANDBY', 'STRIKE_AIR', 'CAS', 'SWEEP', 'ESCORT',
  'RECON', 'INTERDICTION', 'FERRY', 'TANKER', 'SAR', 'LIFT_OFF', 'LAND', 'ASCEND'] as const;
export const SPACE_ORDERS = ['TRANSIT', 'COLD_COAST', 'STATION_KEEP', 'INTERCEPT', 'SKIM_FUEL',
  'RECHARGE_SAIL', 'QUICK_CHARGE', 'JUMP', 'INSPECT', 'BLOCKADE', 'BOARD', 'DESCEND'] as const;
export const ORDER_KINDS = [...GROUND_ORDERS, ...AIR_ORDERS, ...SPACE_ORDERS] as const;
export const TRIGGER_WHENS = ['CONTACT_WITHIN', 'DETECTED_SELF', 'TICK_REACHED', 'HEX_REACHED',
  'FUEL_BELOW', 'RDY_BELOW', 'ALLY_ENGAGED'] as const;

type Json = Record<string, any>;

export function validateCampaign(j: any): string[] {
  const p: string[] = [];
  const err = (m: string) => p.push(m);
  const isObj = (x: any) => x && typeof x === 'object' && !Array.isArray(x);
  const isNum = (x: any) => typeof x === 'number' && Number.isFinite(x);
  const isStr = (x: any) => typeof x === 'string' && x.length > 0;
  const oneOf = (x: any, set: readonly string[]) => set.includes(x);

  if (!isObj(j)) return ['campaign must be a JSON object'];
  if (!isStr(j.seed)) err('seed: required, must be a non-empty string');
  if (!isObj(j.config)) err('config: required object');
  else {
    if (!isStr(j.config.name)) err('config.name: required string');
    if (j.config.weather !== undefined && !oneOf(j.config.weather, WEATHERS)) {
      err(`config.weather: must be one of ${WEATHERS.join('/')}`);
    }
    for (const k of ['dawnTick', 'duskTick', 'vpThreshold', 'endTick']) {
      if (j.config[k] !== undefined && !isNum(j.config[k])) err(`config.${k}: must be a number`);
    }
  }

  // ── theaters ──
  const theaterIds = new Set<string>();
  const theaterDims: Record<string, { w: number; h: number }> = {};
  if (!Array.isArray(j.theaters) || j.theaters.length === 0) {
    err('theaters: required, at least one');
  } else {
    j.theaters.forEach((t: Json, i: number) => {
      const at = `theaters[${i}]${t?.id ? ` "${t.id}"` : ''}`;
      if (!isStr(t.id)) return err(`${at}: id required`);
      if (theaterIds.has(t.id)) err(`${at}: duplicate theater id`);
      theaterIds.add(t.id);
      if (!isNum(t.width) || t.width <= 0) err(`${at}: width must be a positive number`);
      if (!isNum(t.height) || t.height <= 0) err(`${at}: height must be a positive number`);
      theaterDims[t.id] = { w: t.width, h: t.height };
      if (t.defaultTerrain !== undefined && !oneOf(t.defaultTerrain, TERRAINS)) {
        err(`${at}: defaultTerrain must be one of ${TERRAINS.join('/')}`);
      }
      (t.overrides ?? []).forEach((o: Json, k: number) => {
        const ao = `${at}.overrides[${k}]`;
        if (!isNum(o.q) || !isNum(o.r)) err(`${ao}: q,r required`);
        else if (o.q < 0 || o.q >= t.width || o.r < 0 || o.r >= t.height) {
          err(`${ao}: hex ${o.q},${o.r} is outside the ${t.width}×${t.height} theater`);
        }
        if (o.terrain !== undefined && !oneOf(o.terrain, TERRAINS)) err(`${ao}: bad terrain "${o.terrain}"`);
        for (const tag of o.infra ?? []) if (!oneOf(tag, INFRA)) err(`${ao}: bad infra tag "${tag}"`);
        if (o.objective && !isNum(o.objective.vpPerDay)) err(`${ao}.objective: vpPerDay must be a number`);
      });
    });
  }

  // ── sides ──
  const sideIds = new Set<string>();
  if (!Array.isArray(j.sides) || j.sides.length < 1) err('sides: required, at least one');
  else j.sides.forEach((s: Json, i: number) => {
    if (!isStr(s.id)) return err(`sides[${i}]: id required`);
    if (sideIds.has(s.id)) err(`sides[${i}] "${s.id}": duplicate side id`);
    sideIds.add(s.id);
    if (!isStr(s.name)) err(`sides[${i}] "${s.id}": name required`);
    if (s.vp !== undefined && !isNum(s.vp)) err(`sides[${i}] "${s.id}": vp must be a number`);
  });
  const knownSide = (id: any, at: string) => {
    if (id !== undefined && !sideIds.has(id)) err(`${at}: unknown side "${id}"`);
  };
  const inBounds = (theaterId: any, q: any, r: any, at: string) => {
    if (!theaterIds.has(theaterId)) { err(`${at}: unknown theater "${theaterId}"`); return; }
    const d = theaterDims[theaterId];
    if (d && (q < 0 || q >= d.w || r < 0 || r >= d.h)) {
      err(`${at}: hex ${q},${r} is outside theater "${theaterId}" (${d.w}×${d.h})`);
    }
  };

  // ── system graph ──
  const nodeIds = new Set<string>();
  for (const n of j.system?.nodes ?? []) {
    if (!isStr(n.id)) { err('system.nodes: every node needs an id'); continue; }
    if (nodeIds.has(n.id)) err(`system node "${n.id}": duplicate id`);
    nodeIds.add(n.id);
    if (!oneOf(n.type, NODE_TYPES)) err(`system node "${n.id}": bad type "${n.type}"`);
    if (n.theaterId !== undefined && !theaterIds.has(n.theaterId)) {
      err(`system node "${n.id}": unknown theater "${n.theaterId}"`);
    }
    if (n.objective) {
      if (!isNum(n.objective.vpPerDay)) err(`system node "${n.id}".objective: vpPerDay must be a number`);
      knownSide(n.objective.ownerSideId, `system node "${n.id}".objective.ownerSideId`);
    }
  }
  for (const l of j.system?.lanes ?? []) {
    if (!nodeIds.has(l.a) || !nodeIds.has(l.b)) err(`system lane ${l.a}–${l.b}: references an unknown node`);
    if (!isNum(l.distanceAU) || l.distanceAU <= 0) err(`system lane ${l.a}–${l.b}: distanceAU must be positive`);
  }

  // ── facilities ──
  const facilityIds = new Set<string>();
  for (const f of j.facilities ?? []) {
    const at = `facility "${f.id ?? '?'}"`;
    if (!isStr(f.id)) { err('facility: every facility needs an id'); continue; }
    if (facilityIds.has(f.id)) err(`${at}: duplicate id`);
    facilityIds.add(f.id);
    knownSide(f.sideId, `${at}.sideId`);
    inBounds(f.theaterId, f.q, f.r, at);
    for (const tag of f.tags ?? []) if (!oneOf(tag, INFRA)) err(`${at}: bad tag "${tag}"`);
    if (f.capitalBattery) {
      if (!oneOf(f.capitalBattery.weapon, CAPITAL_WEAPON_NAMES)) {
        err(`${at}.capitalBattery: unknown weapon "${f.capitalBattery.weapon}" (one of ${CAPITAL_WEAPON_NAMES.join('/')})`);
      }
      if (f.capitalBattery.shots !== undefined && !isNum(f.capitalBattery.shots)) {
        err(`${at}.capitalBattery.shots: must be a number`);
      }
    }
    // D-051.1: optionally pre-spotted (public installations on prewar maps)
    for (const sid of f.knownTo ?? []) knownSide(sid, `${at}.knownTo`);
  }

  // ── formations & units ──
  const formationIds = new Set<string>();
  for (const f of j.formations ?? []) {
    const at = `formation "${f.id ?? '?'}"`;
    if (!isStr(f.id)) { err('formation: every formation needs an id'); continue; }
    if (formationIds.has(f.id)) err(`${at}: duplicate id`);
    formationIds.add(f.id);
    knownSide(f.sideId, `${at}.sideId`);
    // exactly one position
    const posKinds = [f.nodeId ? 'node' : null, f.airPos ? 'air' : null,
      (f.q !== undefined || f.theaterId !== undefined) ? 'ground' : null].filter(Boolean);
    if (posKinds.length === 0) err(`${at}: needs a position (theaterId+q+r, or airPos, or nodeId)`);
    else if (posKinds.length > 1) err(`${at}: has more than one position (${posKinds.join(', ')})`);
    if (f.nodeId && !nodeIds.has(f.nodeId)) err(`${at}: unknown node "${f.nodeId}"`);
    if (posKinds[0] === 'ground') inBounds(f.theaterId, f.q, f.r, at);
    if (f.emcon !== undefined && !oneOf(f.emcon, EMCONS)) err(`${at}: bad emcon "${f.emcon}"`);
    if (f.posture !== undefined && !oneOf(f.posture, POSTURES)) err(`${at}: bad posture "${f.posture}"`);
    if (f.alertState !== undefined && !oneOf(f.alertState, ALERTS)) err(`${at}: bad alertState "${f.alertState}"`);
    if (f.rdy !== undefined && (!isNum(f.rdy) || f.rdy < 0 || f.rdy > 10)) err(`${at}: rdy must be 0–10`);
    if (f.carriedSp !== undefined && (!isNum(f.carriedSp) || f.carriedSp < 0)) err(`${at}: carriedSp must be ≥ 0`);
    // D-049: standing rules — { when, param, then: { kind, … }, repeat? }
    for (const r of f.rules ?? []) {
      if (!oneOf(r.when, TRIGGER_WHENS)) err(`${at}.rules: bad trigger "${r.when}"`);
      if (!r.then || !oneOf(r.then.kind, ORDER_KINDS)) err(`${at}.rules: bad then-order kind`);
    }
    if (!Array.isArray(f.units) || f.units.length === 0) err(`${at}: needs at least one unit`);
    (f.units ?? []).forEach((u: Json, k: number) => {
      const au = `${at}.units[${k}]`;
      if (!isStr(u.name)) err(`${au}: name required`);
      if (!oneOf(u.class, UNIT_CLASSES)) err(`${au}: bad class "${u.class}"`);
      if (u.damage !== undefined && !oneOf(u.damage, DAMAGE_STATES)) err(`${au}: bad damage "${u.damage}"`);
      if (u.flak !== undefined && (!isNum(u.flak) || u.flak < 0)) err(`${au}: flak must be ≥ 0`);
      if (u.ammoState !== undefined && !oneOf(u.ammoState, AMMO_STATES)) err(`${au}: bad ammoState "${u.ammoState}"`);
      if (isObj(u.pilot)) {
        for (const sk of ['gunnery', 'piloting']) {
          if (u.pilot[sk] !== undefined && (!isNum(u.pilot[sk]) || u.pilot[sk] < 0 || u.pilot[sk] > 8)) {
            err(`${au}.pilot.${sk}: must be 0–8`);
          }
        }
      }
      if (u.drive) {
        if (u.drive.sail !== undefined && !oneOf(u.drive.sail, SAIL_STATES)) err(`${au}.drive: bad sail "${u.drive.sail}"`);
        if (u.drive.kfDamage !== undefined && !oneOf(u.drive.kfDamage, KF_DAMAGE)) err(`${au}.drive: bad kfDamage`);
        if (u.drive.chargePct !== undefined && (!isNum(u.drive.chargePct) || u.drive.chargePct < 0 || u.drive.chargePct > 100)) {
          err(`${au}.drive.chargePct: must be 0–100`);
        }
      }
    });
  }

  // ── carriers & embarked formations (second pass: mountedOn may point forward) ──
  const byId = new Map<string, Json>((j.formations ?? []).map((f: Json) => [f.id, f]));
  for (const f of j.formations ?? []) {
    const at = `formation "${f.id ?? '?'}"`;
    if (f.carrier !== undefined) {
      if (!isObj(f.carrier)) err(`${at}.carrier: must be { bays, crews, avFuelTons }`);
      else {
        if (!isNum(f.carrier.bays) || f.carrier.bays < 1) err(`${at}.carrier.bays: must be ≥ 1`);
        if (!isNum(f.carrier.crews) || f.carrier.crews < 0) err(`${at}.carrier.crews: must be ≥ 0`);
        if (!isNum(f.carrier.avFuelTons) || f.carrier.avFuelTons < 0) err(`${at}.carrier.avFuelTons: must be ≥ 0`);
      }
    }
    if (f.mountedOn !== undefined) {
      const carrier = byId.get(f.mountedOn);
      if (f.mountedOn === f.id) err(`${at}: cannot embark in itself`);
      else if (!carrier) err(`${at}.mountedOn: unknown formation "${f.mountedOn}"`);
      else {
        if (!isObj(carrier.carrier)) err(`${at}.mountedOn: "${f.mountedOn}" is not a carrier (needs a carrier block)`);
        if (carrier.sideId !== f.sideId) err(`${at}.mountedOn: "${f.mountedOn}" belongs to the other side`);
        if (carrier.mountedOn !== undefined) err(`${at}.mountedOn: "${f.mountedOn}" is itself embarked — carriers don't nest`);
      }
    }
  }
  {
    const embarkedBy = new Map<string, number>();
    for (const f of j.formations ?? []) {
      if (f.mountedOn !== undefined) embarkedBy.set(f.mountedOn, (embarkedBy.get(f.mountedOn) ?? 0) + 1);
    }
    for (const [carrierId, n] of embarkedBy) {
      const bays = (byId.get(carrierId) as Json)?.carrier?.bays;
      if (isNum(bays) && n > bays) {
        err(`formation "${carrierId}": ${n} formations embarked but only ${bays} bays`);
      }
    }
  }

  // ── command nodes ──
  for (const [sideId, ids] of Object.entries(j.commandNodes ?? {})) {
    knownSide(sideId, `commandNodes key`);
    for (const id of (ids as string[])) {
      if (!facilityIds.has(id) && !formationIds.has(id)) {
        err(`commandNodes["${sideId}"]: "${id}" is not a facility or formation`);
      }
    }
  }

  // ── satellites ──
  for (const s of j.satellites ?? []) {
    const at = `satellite "${s.id ?? '?'}"`;
    knownSide(s.sideId, `${at}.sideId`);
    if (s.theaterId !== undefined && !theaterIds.has(s.theaterId)) err(`${at}: unknown theater "${s.theaterId}"`);
    if (s.kind !== undefined && !oneOf(s.kind, ['RECON', 'COMM'])) err(`${at}: kind must be RECON or COMM`);
  }

  // ── markers ──
  for (const m of j.markers ?? []) {
    const at = `marker "${m.id ?? '?'}"`;
    if (!oneOf(m.kind, MARKER_KINDS)) err(`${at}: bad kind "${m.kind}"`);
    knownSide(m.sideId, `${at}.sideId`);
    if (m.theaterId !== undefined) inBounds(m.theaterId, m.q, m.r, at);
    else if (m.nodeId !== undefined && !nodeIds.has(m.nodeId)) err(`${at}: unknown node "${m.nodeId}"`);
    else err(`${at}: needs a position (theaterId+q+r or nodeId)`);
  }

  // ── orders ──
  const orderIds = new Set<string>();
  for (const o of j.orders ?? []) {
    const at = `order "${o.id ?? '?'}"`;
    if (!isStr(o.id)) { err('order: every order needs an id'); continue; }
    if (orderIds.has(o.id)) err(`${at}: duplicate id`);
    orderIds.add(o.id);
    knownSide(o.sideId, `${at}.sideId`);
    if (!formationIds.has(o.formationId)) err(`${at}: unknown formation "${o.formationId}"`);
    if (!oneOf(o.kind, ORDER_KINDS)) err(`${at}: bad kind "${o.kind}"`);
    for (const c of o.conditionals ?? []) {
      if (!c.trigger || !oneOf(c.trigger.when, TRIGGER_WHENS)) err(`${at}: bad conditional trigger`);
      if (!c.then || !oneOf(c.then.kind, ORDER_KINDS)) err(`${at}: bad conditional then-order kind`);
    }
  }

  return p;
}
