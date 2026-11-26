// Campaign geography: eight islands west to east, the customers who write to
// each other across them, and the ring courses laid over each hop.
import { mulberry32, FT } from './util.js';

export const ISLANDS = [
  { id: 'bali', name: 'Bali', seed: 1101 },
  { id: 'penida', name: 'Nusa Penida', seed: 1207 },
  { id: 'lombok', name: 'Lombok', seed: 1313 },
  { id: 'sumbawa', name: 'Sumbawa', seed: 1421 },
  { id: 'flores', name: 'Flores', seed: 1529 },
  { id: 'sulawesi', name: 'Sulawesi', seed: 1637 },
  { id: 'maluku', name: 'Maluku', seed: 1741 },
  { id: 'papua', name: 'Papua', seed: 1853 },
];
// Hop distances in metres; a hop at cruise takes roughly 60–85 seconds.
export const HOP_M = [2300, 2500, 2650, 2800, 2900, 2750, 2950];

export const CUSTOMERS = [
  { name: 'Ibu Ratna', cargo: 'a crate of temple flowers', cargoId: 'sekeranjang bunga sesajen' },
  { name: 'Pak Wayan', cargo: 'spare outboard parts, wrapped twice', cargoId: 'suku cadang mesin tempel, dibungkus dua kali' },
  { name: 'Dr. Sari', cargo: 'vaccines in a cold box — keep them level', cargoId: 'vaksin dalam kotak pendingin — jaga tetap datar' },
  { name: 'Pak Haji Umar', cargo: 'letters for the whole village', cargoId: 'surat untuk seluruh desa' },
  { name: 'Ibu Made', cargo: 'a wedding dress, folded like a secret', cargoId: 'gaun pengantin, dilipat seperti rahasia' },
  { name: 'Pak Dominggus', cargo: 'coffee beans, still warm from the roast', cargoId: 'biji kopi, masih hangat dari sangrai' },
  { name: 'Ibu Fransiska', cargo: 'school books for forty children', cargoId: 'buku sekolah untuk empat puluh anak' },
  { name: 'Pak Yohanis', cargo: 'a guitar for his daughter', cargoId: 'sebuah gitar untuk putrinya' },
  { name: 'Ibu Kadek', cargo: 'medicine for her mother', cargoId: 'obat untuk ibunya' },
  { name: 'Pak La Ode', cargo: 'pearl oysters in wet sacking', cargoId: 'tiram mutiara dalam karung basah' },
];

// Lay a course of golden rings over a hop. Ring altitudes ride a climb-then-
// descend arc and are hard-capped by the plane's climb envelope, so a player
// who takes off promptly can always reach the next ring.
export function ringCourse(legDistM, count, seed) {
  const rnd = mulberry32(seed);
  const rings = [];
  for (let i = 0; i < count; i++) {
    const f = (i + 1) / (count + 1);
    const dist = legDistM * f;
    // Climb envelope: feet reachable at fraction f of the leg (takeoff, cruise, descend).
    const arc = Math.min(f * 2.4, (1 - f) * 2.6, 1);
    const ceilingFT = 26 + arc * 185;
    const altFT = 30 + rnd() * Math.max(10, ceilingFT - 44);
    rings.push({
      dist, altM: altFT * FT, x: (rnd() * 2 - 1) * 15,
      passed: false, missed: false,
    });
  }
  return rings;
}
export function ringCountFor(legDistM) { return legDistM > 2700 ? 6 : 5; }
