export function applyAction(maxClicked, index, total) {
  if (index === maxClicked + 1 && maxClicked < total) {
    return maxClicked + 1;
  }

  if (index === maxClicked && maxClicked > 0) {
    return maxClicked - 1;
  }

  return maxClicked;
}

const BLAST_PROFILES = [
  { pieceCount: 10, radiusRange: [16, 24] },
  { pieceCount: 16, radiusRange: [26, 34] },
  { pieceCount: 24, radiusRange: [36, 44] },
];

export function pickBlastProfile(randomFn = Math.random) {
  const index = Math.floor(randomFn() * BLAST_PROFILES.length);
  return BLAST_PROFILES[Math.min(index, BLAST_PROFILES.length - 1)];
}
