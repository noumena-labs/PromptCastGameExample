export type WizardProfile = {
  name: string;
  color: string;
  profileId: string;
};

const PROFILE_STORAGE_KEY = "promptcast-wizard-profile";

export const DEFAULT_WIZARD_PROFILE: WizardProfile = {
  name: "Apprentice",
  color: "#7a1f1f",
  profileId: "local-profile",
};

export function loadWizardProfile(): WizardProfile {
  if (typeof window === "undefined") return DEFAULT_WIZARD_PROFILE;

  try {
    const stored = window.sessionStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return normalizeWizardProfile({});
    const parsed = JSON.parse(stored) as Partial<WizardProfile>;
    return normalizeWizardProfile(parsed);
  } catch {
    return normalizeWizardProfile({});
  }
}

export function saveWizardProfile(profile: WizardProfile) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizeWizardProfile(profile)));
  } catch {
    // Storage can be disabled; multiplayer still works with the in-memory profile.
  }
}

function normalizeWizardProfile(profile: Partial<WizardProfile>): WizardProfile {
  const name = typeof profile.name === "string" ? profile.name.trim().slice(0, 18) : "";
  const color = typeof profile.color === "string" && profile.color.trim() ? profile.color.trim().slice(0, 32) : DEFAULT_WIZARD_PROFILE.color;
  const profileId = typeof profile.profileId === "string" && profile.profileId.trim() ? profile.profileId.trim().slice(0, 96) : createProfileId();

  return {
    name: name || DEFAULT_WIZARD_PROFILE.name,
    color,
    profileId,
  };
}

function createProfileId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
