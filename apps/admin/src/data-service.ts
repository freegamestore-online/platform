/** Read-only game/dashboard data boundary used by the admin API dispatcher. */
export interface AdminDataService<Game, RegistryItem, Quality, Status> {
  registryItems(): Promise<RegistryItem[] | null>;
  registry(): Promise<Game[]>;
  registryRaw(): Promise<RegistryItem[]>;
  gameStatus(game: Game): Promise<Status>;
  allStatus(): Promise<Status[]>;
  quality(): Promise<Quality | null>;
}

/** Identity composition keeps data sources injectable without coupling routing to them. */
export function createAdminDataService<Game, RegistryItem, Quality, Status>(
  operations: AdminDataService<Game, RegistryItem, Quality, Status>,
): AdminDataService<Game, RegistryItem, Quality, Status> {
  return operations;
}
