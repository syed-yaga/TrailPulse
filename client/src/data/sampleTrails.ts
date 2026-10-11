export interface SampleTrail {
  id: string;
  title: string;
  location: string;
  stopsCount: number;
  duration: string;
  badge: string;
  description: string;
  bundleUrl: string;
}

export const SAMPLE_TRAILS: SampleTrail[] = [
  {
    id: "red-fort",
    title: "Red Fort Quick Tour",
    location: "Old Delhi, Delhi",
    stopsCount: 2,
    duration: "45s Demo",
    badge: " UNESCO Heritage",
    description:
      "Rapid heritage vignette: Lahori Gate entry to the vaulted Chhatta Chowk bazaar.",
    bundleUrl: "/trails/red-fort.zip",
  },
  {
    id: "humayuns-tomb",
    title: "Humayun's Tomb Garden",
    location: "Nizamuddin East, Delhi",
    stopsCount: 2,
    duration: "45s Demo",
    badge: " UNESCO Heritage",
    description:
      "Bite-sized walk: Isa Khan octagonal tomb to the West Gate garden portal.",
    bundleUrl: "/trails/humayuns-tomb.zip",
  },
];
