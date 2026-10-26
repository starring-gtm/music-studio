const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Transpose a key name like "F minor" by semitones: ("F minor", 2) -> "G minor". */
export function transposeKey(key: string, semitones: number): string {
  const [tonic, mode] = key.split(" ");
  const index = PITCH_CLASSES.indexOf(tonic);
  if (index < 0) return key;
  const shifted = PITCH_CLASSES[(((index + semitones) % 12) + 12) % 12];
  return mode ? `${shifted} ${mode}` : shifted;
}

export function formatSemitones(semitones: number): string {
  return semitones > 0 ? `+${semitones}` : String(semitones);
}
