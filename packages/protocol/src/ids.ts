/**
 * Branded numeric IDs. Compact at runtime (plain numbers); the brand exists
 * only at the type level so a ComponentId can never be passed where an EventId
 * is expected. Human-readable strings are produced at the UI boundary.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RootId = Brand<number, "RootId">;
export type ComponentId = Brand<number, "ComponentId">;
export type ComponentType = Brand<number, "ComponentType">;
export type RenderId = Brand<number, "RenderId">;
export type CommitId = Brand<number, "CommitId">;
export type EventId = Brand<number, "EventId">;
export type InteractionId = Brand<number, "InteractionId">;
export type EffectId = Brand<number, "EffectId">;

/**
 * A monotonic counter factory. Each capture domain (events, renders, …) owns
 * one so IDs stay compact and collision-free within a session.
 */
export function createIdFactory<T extends number>(): () => T {
  let next = 1;
  return () => next++ as T;
}
