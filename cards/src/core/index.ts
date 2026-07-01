/**
 * Public entry point for the pure core layer.
 *
 * Import from here in both Node and browser contexts — nothing reachable from
 * this barrel touches the filesystem, Node globals, or the DOM.
 */

export * from "./types.js";
export * from "./constants.js";
export * from "./parser.js";
export * from "./convert.js";
export * from "./blk.js";
export * from "./battlearmor.js";
export * from "./vehicle.js";
export * from "./fighter.js";
export * from "./infantry.js";
export * from "./proto.js";
export * from "./dropship.js";
export * from "./dispatch.js";
