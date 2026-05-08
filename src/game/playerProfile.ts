export type WizardProfile = {
  name: string;
  color: string;
  profileId: string;
};

const PROFILE_STORAGE_KEY = "promptcast-wizard-profile";

const DEFAULT_MANTLE_COLORS = ["#7a1f1f", "#365a3a", "#2c4a7c", "#b88a2c", "#5a2470", "#8a4a1c"];

const MAGE_FIRST_NAMES = [
  "Aurelian",
  "Bellatrix",
  "Cassian",
  "Elowen",
  "Fenwick",
  "Garrick",
  "Isolde",
  "Lysander",
  "Morgelyn",
  "Percival",
  "Rowena",
  "Seraphine",
  "Thalric",
  "Vespera",
  "Wulfric",
  "Ysolda",
];

const MAGE_LAST_NAMES = [
  "Ashenvale",
  "Blackbriar",
  "Duskwhisper",
  "Eldermoor",
  "Fallowmere",
  "Glimmerwick",
  "Hawthorne",
  "Moonveil",
  "Nightbloom",
  "Ravencrest",
  "Silverwand",
  "Starling",
  "Stormhollow",
  "Thornfield",
  "Umbergrave",
  "Wyrmwood",
];

export const DEFAULT_WIZARD_PROFILE: WizardProfile = {
  name: "Aurelian Ashenvale",
  color: "#7a1f1f",
  profileId: "local-profile",
};

export function loadWizardProfile(): WizardProfile {
  return createRandomWizardProfile(loadProfileId());
}

export function saveWizardProfile(profile: WizardProfile) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ profileId: normalizeWizardProfile(profile).profileId }));
  } catch {
    // Storage can be disabled; multiplayer still works with a transient profile id.
  }
}

function loadProfileId() {
  if (typeof window === "undefined") return DEFAULT_WIZARD_PROFILE.profileId;
  try {
    const stored = window.sessionStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return createProfileId();
    const parsed = JSON.parse(stored) as Partial<WizardProfile>;
    return typeof parsed.profileId === "string" && parsed.profileId.trim()
      ? parsed.profileId.trim().slice(0, 96)
      : createProfileId();
  } catch {
    return createProfileId();
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

function createRandomWizardProfile(profileId = createProfileId()): WizardProfile {
  return {
    name: `${randomItem(MAGE_FIRST_NAMES)} ${randomItem(MAGE_LAST_NAMES)}`.slice(0, 18),
    color: randomItem(DEFAULT_MANTLE_COLORS),
    profileId,
  };
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function createProfileId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
