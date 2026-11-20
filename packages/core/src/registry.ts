import type { ModelDefinition } from "./model";

// Stored type-erased; callers re-narrow with their own generic parameters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = ModelDefinition<any, any>;

const models = new Map<string, AnyModel>();

export const modelKey = (id: string, version: string): string => `${id}@${version}`;

export function registerModel(model: AnyModel): void {
  const key = modelKey(model.id, model.version);
  const existing = models.get(key);
  if (existing && existing !== model) throw new Error(`model ${key} is already registered`);
  models.set(key, model);
}

export function getModel(id: string, version: string): AnyModel {
  const m = models.get(modelKey(id, version));
  if (!m) throw new Error(`model ${modelKey(id, version)} is not registered`);
  return m;
}

export function listModels(): string[] {
  return [...models.keys()].sort();
}
