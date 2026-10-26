import { useEffect, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles.css';

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;

function MapSizeInvalidator({ active, containerRef }) {
  const map = useMap();

  useEffect(() => {
    if (!active) return undefined;

    let firstAnimationFrame = 0;
    let secondAnimationFrame = 0;
    const retryTimers = [];
    const invalidate = () => map.invalidateSize({ pan: false });
    const scheduleInvalidate = () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      window.cancelAnimationFrame(secondAnimationFrame);
      firstAnimationFrame = window.requestAnimationFrame(() => {
        secondAnimationFrame = window.requestAnimationFrame(invalidate);
      });
    };

    scheduleInvalidate();
    retryTimers.push(
      window.setTimeout(scheduleInvalidate, 150),
      window.setTimeout(scheduleInvalidate, 350)
    );

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleInvalidate);
    const mapContainer = map.getContainer();
    if (containerRef.current) observer?.observe(containerRef.current);
    observer?.observe(mapContainer);
    if (!observer) window.addEventListener('resize', scheduleInvalidate);

    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      window.cancelAnimationFrame(secondAnimationFrame);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', scheduleInvalidate);
    };
  }, [active, containerRef, map]);

  return null;
}

function MapClickPicker({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng);
    },
  });
  return null;
}

export function AttendanceLocationsMap({ locations, draft, onSelect, active }) {
  const containerRef = useRef(null);
  const defaultPosition = locations.length
    ? [locations[0].latitude, locations[0].longitude]
    : [-6.2088, 106.8456];
  const center = draft.latitude && draft.longitude
    ? [Number(draft.latitude), Number(draft.longitude)]
    : defaultPosition;
  const draftRadius = Number(draft.radius_meters);
  const hasDraftRadius = Number.isFinite(draftRadius) && draftRadius > 0;
  return (
    <div className="attendance-location-map-shell" ref={containerRef}>
      <MapContainer className="attendance-location-map" center={center} zoom={13} scrollWheelZoom>
        <MapSizeInvalidator active={active} containerRef={containerRef} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY || '')}`}
          subdomains="abcd"
          maxZoom={20}
        />
        <MapClickPicker onSelect={onSelect} />
        {locations.map((location) => (
          <Circle
            key={location.id}
            center={[location.latitude, location.longitude]}
            radius={location.radius_meters}
            pathOptions={{ color: '#4e62df', fillColor: '#5368df', fillOpacity: 0.12 }}
          />
        ))}
        {center.every(Number.isFinite) && hasDraftRadius && (
          <Circle
            center={center}
            radius={draftRadius}
            pathOptions={{ color: '#e25b63', fillColor: '#e25b63', fillOpacity: 0.1, dashArray: '6 6' }}
          />
        )}
        {center.every(Number.isFinite) && (
          <CircleMarker center={center} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#e25b63', fillOpacity: 1 }} />
        )}
      </MapContainer>
    </div>
  );
}
