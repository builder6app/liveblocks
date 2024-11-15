import type { Json } from "./lib/Json.js";

declare const brand: unique symbol;
export type Brand<T, TBrand extends string> = T & { [brand]: TBrand };

// XXX OpId should really be a Lamport timestamp, ie a [actor, clock] tuple
export type OpId = Brand<string, "OpId">;
export type Op = readonly [id: OpId, name: string, args: readonly Json[]];
export type Delta = readonly [
  id: OpId,
  rem: readonly string[],
  add: readonly [key: string, value: Json][],
]; // Eventually, we'll need to compress this

export type OmitFirstArg<F> = F extends (
  first: unknown,
  ...args: infer A
) => infer R
  ? (...args: A) => R
  : never;

export type ChangeReturnType<F, T> = F extends (...args: infer A) => unknown
  ? (...args: A) => T
  : never;
