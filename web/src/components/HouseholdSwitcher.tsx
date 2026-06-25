import { Link } from 'react-router-dom';
import { useHousehold, useMyHouseholds, useSwitchHousehold } from '../api/household.js';
import ProfileMenu from './ProfileMenu.js';

// Always-visible bar to see and switch the active household. Switching clears the
// query cache so every screen reloads for the new household — data stays
// segregated between households. (Creating households lives in System Settings.)
export default function HouseholdSwitcher() {
  const active = useHousehold();
  const mine = useMyHouseholds();
  const switchHh = useSwitchHousehold();

  if (!active.data) return null;

  const households = mine.data ?? [];
  const busy = switchHh.isPending;

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
      <span className="shrink-0 text-xs font-medium text-gray-500">Household</span>
      {households.length > 0 ? (
        <select
          className="select flex-1 py-1.5"
          value={active.data.id}
          disabled={busy}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id !== active.data!.id) switchHh.mutate(id);
          }}
        >
          {households.map((h) => (
            <option key={h.household.id} value={h.household.id}>
              {h.household.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 truncate text-sm font-semibold">{active.data.name}</span>
      )}
      <Link
        to="/guide"
        aria-label="Help & getting-started guide"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand bg-white text-sm font-bold text-brand transition-[transform,box-shadow] hover:shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        ?
      </Link>
      <ProfileMenu />
    </div>
  );
}
