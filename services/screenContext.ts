let currentScreen: string | null = null;

export function setCurrentScreen(label: string | null): void {
  currentScreen = label;
}

export function getCurrentScreen(): string | null {
  return currentScreen;
}
