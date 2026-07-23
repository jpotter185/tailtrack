import { useState, type FormEvent } from "react";
import { geocodeLocation } from "../lib/geocode";
import type { RadiusUnit } from "../lib/api";

export interface SearchParams {
  lat: number;
  lon: number;
  radius: number;
  unit: RadiusUnit;
}

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  loading: boolean;
}

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [location, setLocation] = useState("");
  const [radius, setRadius] = useState(25);
  const [unit, setUnit] = useState<RadiusUnit>("mi");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!location.trim()) {
      setError("Enter a location, or use your current location.");
      return;
    }
    try {
      const result = await geocodeLocation(location);
      onSearch({ lat: result.lat, lon: result.lon, radius, unit });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleUseCurrentLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation isn't supported in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onSearch({ lat: position.coords.latitude, lon: position.coords.longitude, radius, unit });
      },
      (geoError) => {
        setLocating(false);
        setError(`Couldn't get your location: ${geoError.message}`);
      },
    );
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="City, address, or airport..."
        value={location}
        onChange={(event) => setLocation(event.target.value)}
      />
      <button type="button" onClick={handleUseCurrentLocation} disabled={locating}>
        {locating ? "Locating..." : "Use my location"}
      </button>
      <input
        type="number"
        min={1}
        max={250}
        value={radius}
        onChange={(event) => setRadius(Number(event.target.value))}
      />
      <select value={unit} onChange={(event) => setUnit(event.target.value as RadiusUnit)}>
        <option value="mi">miles</option>
        <option value="nm">nautical miles</option>
      </select>
      <button type="submit" disabled={loading}>
        {loading ? "Searching..." : "Search"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
