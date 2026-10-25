/** Artwork coordinates, independent of voice transport. Masks describe real artwork, not replacement art. */
export const ART_WIDTH = 1024;
export const ART_HEIGHT = 1536;
export const FRAME_HEIGHT = 1120;
export type Region = { x: number; y: number; rx: number; ry: number };
export const RIG = {
  leftEye: { x: 409, y: 388, rx: 77, ry: 48 },
  rightEye: { x: 588, y: 364, rx: 78, ry: 48 },
  leftBrow: { x: 410, y: 327, rx: 67, ry: 24 },
  rightBrow: { x: 575, y: 314, rx: 67, ry: 25 },
  mouth: { x: 505, y: 515, rx: 80, ry: 48 },
  leftTear: { x: 404, y: 465, rx: 55, ry: 100 },
  rightTear: { x: 602, y: 451, rx: 55, ry: 110 },
} satisfies Record<string, Region>;

export const HAIR_PARTS = [
  { name: 'bangs', pivot: [507, 91], path: 'M 314 126 C 378 65 490 53 535 88 C 546 177 536 266 505 319 C 478 356 428 374 369 356 L 297 374 C 341 299 353 204 314 126 Z' },
  { name: 'left', pivot: [287, 320], path: 'M 281 318 C 313 337 335 422 323 489 C 327 618 334 774 288 931 C 263 1042 220 1194 193 1327 L 123 1267 C 142 1138 151 1000 190 851 C 226 732 251 602 250 504 Z' },
  { name: 'right', pivot: [680, 303], path: 'M 677 304 C 718 361 747 478 798 555 C 841 621 899 648 933 737 L 900 791 C 858 708 791 665 755 606 C 714 537 675 415 656 339 Z' },
] as const;