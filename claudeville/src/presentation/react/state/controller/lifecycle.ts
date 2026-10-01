export interface BootDeps {
  isBooted(): boolean;
  loadInitialData(): Promise<void>;
  getUsage(): Promise<unknown>;
  publishUsage(usage: unknown): void;
  startWatcher(): void;
  markBooted(): void;
  syncAgents(): void;
  syncBuildings(): void;
  emitChange(): void;
  markBootError(error: Error): void;
}

export async function bootController(deps: BootDeps): Promise<void> {
  if (deps.isBooted()) {
    return;
  }

  try {
    await deps.loadInitialData();
    const usage = await deps.getUsage();
    if (usage) {
      deps.publishUsage(usage);
    }
    deps.startWatcher();
    deps.markBooted();
    deps.syncAgents();
    deps.syncBuildings();
    deps.emitChange();
  } catch (error) {
    const bootError = error instanceof Error ? error : new Error(String(error));
    deps.markBootError(bootError);
    deps.emitChange();
    throw bootError;
  }
}

export interface DisposeDeps {
  stopWatcher(): void;
  unsubscribers: Array<() => void>;
  clearToastTimers(): void;
}

export function disposeController(deps: DisposeDeps): void {
  deps.stopWatcher();
  for (const unsubscribe of deps.unsubscribers) {
    unsubscribe();
  }
  deps.unsubscribers.length = 0;
  deps.clearToastTimers();
}
