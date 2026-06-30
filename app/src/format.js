// Display helpers: labels + brand-aware colors for partner types and statuses.
export const TYPE_LABEL = {
  food_bank: "Food bank",
  food_pantry: "Food pantry",
  soup_kitchen: "Soup kitchen",
  shelter: "Shelter",
  community_centre: "Community center",
  other: "Other"
};

export const TYPE_COLOR = {
  food_bank: "#1b5e20",
  food_pantry: "#2e7d32",
  soup_kitchen: "#FF6500",
  shelter: "#6a1b9a",
  community_centre: "#00838f",
  other: "#5f6368"
};

// Assignment lifecycle: proposed → reminded → confirmed → delivered.
export const STATUS_ORDER = ["proposed", "reminded", "confirmed", "delivered"];
export const STATUS_LABEL = {
  proposed: "Proposed",
  reminded: "Reminder sent",
  confirmed: "Confirmed",
  delivered: "Delivered"
};
export const STATUS_COLOR = {
  proposed: "#5f6368",
  reminded: "#FF6500",
  confirmed: "#1e8e3e",
  delivered: "#003366"
};

export const fmtMiles = (m) => `${m.toFixed(1)} mi`;
export const fmtInt = (n) => Number(n).toLocaleString("en-US");
export const typeLabel = (t) => TYPE_LABEL[t] || t;
export const typeColor = (t) => TYPE_COLOR[t] || TYPE_COLOR.other;

export function fmtDate(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
