import { z } from 'zod';

export const restaurantLocation = Object.freeze({
  latitude: 13.944698337170372,
  longitude: 100.54483398858625,
  radiusMeters: 200,
});

export const locationInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100),
  timestamp: z.number().int().positive(),
}).strict();

export function locationError(location, now = Date.now()) {
  if (!locationInput.safeParse(location).success)
    return 'กรุณาเปิดตำแหน่งที่แม่นยำ แล้วลองส่งรายการอีกครั้ง';
  if (now - location.timestamp > 30000 || location.timestamp > now + 5000)
    return 'ตำแหน่งหมดอายุ กรุณาลองส่งรายการอีกครั้ง';
  const radians = (value) => value * Math.PI / 180;
  const deltaLat = radians(location.latitude - restaurantLocation.latitude);
  const deltaLng = radians(location.longitude - restaurantLocation.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(restaurantLocation.latitude)) * Math.cos(radians(location.latitude)) *
    Math.sin(deltaLng / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  return distance > restaurantLocation.radiusMeters
    ? 'ส่งรายการได้เฉพาะภายในรัศมี 200 เมตรจากร้าน กรุณากลับเข้าพื้นที่ร้าน'
    : null;
}
