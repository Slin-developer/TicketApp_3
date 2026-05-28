// Generic repository contract. Concrete services (e.g. eventsService) implement
// the slice they need; nothing is forced to provide every method.
// Per ARCHITECTURE.md, all methods throw on failure.
export interface IRepository<TRow, TInsert = Partial<TRow>, TUpdate = Partial<TRow>> {
  list(filter?: Record<string, unknown>): Promise<TRow[]>
  get(id: string): Promise<TRow | null>
  create(input: TInsert): Promise<TRow>
  update(id: string, patch: TUpdate): Promise<TRow>
  remove(id: string): Promise<void>
}
