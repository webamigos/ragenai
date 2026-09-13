/**
 * Builds tabele-bilingual-v1's documents.
 *
 *     node apps/web/evals/rag-benchmark/corpora/tabele-bilingual-v1/build-corpus.mjs
 *
 * Prints the rows the questions cite, so `questions.json` can be written
 * against the corpus rather than the other way round. Deterministic: the same
 * seed produces the same figures, so re-running does not invalidate a result
 * already in `results/`.
 *
 * Kept as a script because the point of the corpus is table *length* — sixty
 * rows each, so a document is fifteen-plus chunks and the header chunk is not
 * simply retrieved alongside the row being asked about. Hand-typing that many
 * figures invites a duplicate, and a duplicated figure makes an `expectNone`
 * meaningless.
 */
import { writeFileSync } from 'fs';
import { createRequire } from 'module';

// `xlsx` is a worker dependency, hoisted to the monorepo root. Resolved from
// the repository root rather than imported, because this directory has no
// package.json of its own and the eval harness does not depend on the worker.
const XLSX = createRequire(
  new URL('../../../../../../package.json', import.meta.url),
)('xlsx');

const DIR = new URL('./docs/', import.meta.url).pathname;

/** Deterministic, so re-running produces the same corpus. */
let seed = 20260912;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const plMoney = (n) =>
  n
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const enMoney = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const PL_EQUIPMENT = [
  'Szlifierka kątowa',
  'Wiertarka udarowa',
  'Spawarka inwertorowa',
  'Palnik acetylenowy',
  'Prasa hydrauliczna',
  'Suwmiarka cyfrowa',
  'Mikrometr warsztatowy',
  'Tokarka stołowa',
  'Frezarka pionowa',
  'Piec indukcyjny',
  'Odciąg spalin',
  'Kompresor śrubowy',
  'Myjka ultradźwiękowa',
  'Kamera termowizyjna',
  'Miernik grubości powłok',
  'Defektoskop ultradźwiękowy',
  'Stół spawalniczy',
  'Wyciąg kanałowy',
  'Mikroskop warsztatowy',
  'Twardościomierz Rockwella',
  'Wagosuszarka laboratoryjna',
  'Chromatograf gazowy',
  'Nożyce gilotynowe',
  'Zaginarka segmentowa',
  'Walcarka trójwalcowa',
  'Przecinarka taśmowa',
  'Szlifierka do płaszczyzn',
  'Dłutownica pionowa',
  'Wiertarka promieniowa',
  'Wytaczarka pozioma',
  'Centrum obróbcze pionowe',
  'Elektrodrążarka drutowa',
  'Piaskarka kabinowa',
  'Kabina lakiernicza',
  'Suszarka natryskowa',
  'Wanna galwaniczna',
  'Prostownik spawalniczy',
  'Podajnik drutu',
  'Pozycjoner spawalniczy',
  'Obrotnik rolkowy',
  'Żuraw słupowy',
  'Wciągnik łańcuchowy',
  'Wózek paletowy elektryczny',
  'Regał paletowy',
  'Waga platformowa',
  'Detektor gazów',
  'Analizator spalin',
  'Spektrometr iskrowy',
  'Mikroskop metalograficzny',
  'Przecinarka precyzyjna',
  'Prasa do zalewania próbek',
  'Polerka metalograficzna',
  'Twardościomierz Vickersa',
  'Młot Charpy’ego',
  'Maszyna wytrzymałościowa',
  'Ekstensometr laserowy',
  'Komora solna',
  'Komora klimatyczna',
  'Wibrator rezonansowy',
  'Stanowisko do prób szczelności',
];
const EN_EQUIPMENT = [
  'Angle grinder',
  'Impact drill',
  'Inverter welder',
  'Acetylene torch',
  'Hydraulic press',
  'Digital calliper',
  'Bench micrometer',
  'Bench lathe',
  'Vertical milling machine',
  'Induction furnace',
  'Fume extractor',
  'Screw compressor',
  'Ultrasonic cleaner',
  'Thermal imaging camera',
  'Coating thickness gauge',
  'Ultrasonic flaw detector',
  'Welding table',
  'Duct extractor',
  'Workshop microscope',
  'Rockwell hardness tester',
  'Laboratory moisture analyser',
  'Gas chromatograph',
  'Guillotine shears',
  'Segmented folder',
  'Three-roll bending machine',
  'Band saw',
  'Surface grinder',
  'Vertical slotting machine',
  'Radial drilling machine',
  'Horizontal boring mill',
  'Vertical machining centre',
  'Wire EDM machine',
  'Blast cabinet',
  'Spray booth',
  'Drying oven',
  'Plating tank',
  'Welding rectifier',
  'Wire feeder',
  'Welding positioner',
  'Roller turntable',
  'Pillar jib crane',
  'Chain hoist',
  'Electric pallet truck',
  'Pallet racking',
  'Platform scale',
  'Gas detector',
  'Flue gas analyser',
  'Spark spectrometer',
  'Metallographic microscope',
  'Precision cut-off machine',
  'Specimen mounting press',
  'Metallographic polisher',
  'Vickers hardness tester',
  'Charpy impact hammer',
  'Universal testing machine',
  'Laser extensometer',
  'Salt spray chamber',
  'Climatic chamber',
  'Resonance shaker',
  'Leak test rig',
];

const PL_SERVICES = [
  'Toczenie CNC',
  'Frezowanie CNC',
  'Spawanie TIG',
  'Spawanie MIG/MAG',
  'Cięcie plazmowe',
  'Cięcie laserowe',
  'Gięcie blach',
  'Obróbka cieplna',
  'Azotowanie jonowe',
  'Galwanizacja',
  'Malowanie proszkowe',
  'Piaskowanie',
  'Kontrola ultradźwiękowa',
  'Kontrola radiograficzna',
  'Pomiary współrzędnościowe',
  'Wyważanie dynamiczne',
  'Regeneracja wałów',
  'Napawanie plazmowe',
  'Montaż konstrukcji stalowych',
  'Nadzór technologiczny',
  'Docieranie powierzchni',
  'Honowanie otworów',
  'Szlifowanie bezkłowe',
  'Nacinanie uzębień',
  'Przeciąganie wielowypustów',
  'Walcowanie gwintów',
  'Kucie matrycowe',
  'Prostowanie termiczne',
  'Wyżarzanie odprężające',
  'Hartowanie indukcyjne',
  'Odpuszczanie próżniowe',
  'Nawęglanie gazowe',
  'Chromowanie techniczne',
  'Cynkowanie ogniowe',
  'Anodowanie twarde',
  'Pasywacja chemiczna',
  'Trawienie kwaśne',
  'Mycie przemysłowe',
  'Kontrola magnetyczno-proszkowa',
  'Badanie penetracyjne',
  'Pomiar chropowatości',
  'Analiza drgań',
  'Termografia maszyn',
  'Endoskopia przemysłowa',
  'Kalibracja przyrządów',
  'Legalizacja wag',
  'Projektowanie oprzyrządowania',
  'Symulacja odlewania',
  'Optymalizacja wsadu',
  'Audyt technologiczny',
];
const EN_SERVICES = [
  'CNC turning',
  'CNC milling',
  'TIG welding',
  'MIG/MAG welding',
  'Plasma cutting',
  'Laser cutting',
  'Sheet bending',
  'Heat treatment',
  'Plasma nitriding',
  'Electroplating',
  'Powder coating',
  'Shot blasting',
  'Ultrasonic inspection',
  'Radiographic inspection',
  'Coordinate measurement',
  'Dynamic balancing',
  'Shaft reconditioning',
  'Plasma hardfacing',
  'Steel structure assembly',
  'Process engineering supervision',
  'Surface lapping',
  'Bore honing',
  'Centreless grinding',
  'Gear cutting',
  'Spline broaching',
  'Thread rolling',
  'Die forging',
  'Flame straightening',
  'Stress-relief annealing',
  'Induction hardening',
  'Vacuum tempering',
  'Gas carburising',
  'Hard chrome plating',
  'Hot-dip galvanising',
  'Hard anodising',
  'Chemical passivation',
  'Acid pickling',
  'Industrial washing',
  'Magnetic particle inspection',
  'Dye penetrant testing',
  'Roughness measurement',
  'Vibration analysis',
  'Machine thermography',
  'Industrial endoscopy',
  'Instrument calibration',
  'Scale verification',
  'Tooling design',
  'Casting simulation',
  'Charge optimisation',
  'Process audit',
];

const PERIODS = [24, 36, 48, 60, 72, 84, 96];

/**
 * Every figure is at least five digits once separators are stripped.
 *
 * `normalizeDigits` in the grader reduces both sides of a comparison to their
 * digits, which is what lets "2 228,80" and "2,228.80" compare equal across
 * the two locales. It also means a short expectation matches inside a longer
 * number, so a three-digit `expectNone` would trip on an unrelated figure and
 * fail a correct answer. Nothing below is allowed to be short.
 */
function equipmentRows(names, codePrefix, codeStart, min, max) {
  return names.map((name, i) => {
    const list = Math.round((min + rand() * (max - min)) * 100) / 100;
    const cap = Math.round(list * (0.62 + rand() * 0.08) * 100) / 100;
    return {
      code: `${codePrefix}-${codeStart + i * 23}`,
      name,
      list,
      cap,
      period: PERIODS[Math.floor(rand() * PERIODS.length)],
    };
  });
}

function serviceRows(names, codePrefix, codeStart, min, max) {
  return names.map((name, i) => {
    const base = Math.round((min + rand() * (max - min)) * 100) / 100;
    return {
      code: `${codePrefix}-${codeStart + i * 3}`,
      name,
      base,
      oob: Math.round(base * 1.5 * 100) / 100,
      min: [1, 2, 3, 4, 8][Math.floor(rand() * 5)],
    };
  });
}

const plEquipment = equipmentRows(PL_EQUIPMENT, 'CD', 1104, 820, 48000);
const enEquipment = equipmentRows(EN_EQUIPMENT, 'TF', 2104, 190, 11000);
const plServices = serviceRows(PL_SERVICES, 'SR', 201, 112, 448);
const enServices = serviceRows(EN_SERVICES, 'SV', 301, 26, 104);

const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows,
  ].join('\n');

writeFileSync(
  `${DIR}/pl-01-limity-sprzetowe.md`,
  `# Zakłady Metalurgiczne „Czarny Dunajec" sp. z o.o.

## Załącznik nr 3 — limity zwrotu kosztów zakupu sprzętu warsztatowego

Dokument obowiązuje od 1 marca 2026 r. i zastępuje załącznik nr 3 w brzmieniu
z 2024 r. Limit zwrotu jest kwotą maksymalną, jaką spółka refunduje
pracownikowi po przedstawieniu faktury; cena katalogowa ma charakter wyłącznie
informacyjny i nie stanowi podstawy rozliczenia.

${table(
  [
    'Kod pozycji',
    'Nazwa sprzętu',
    'Cena katalogowa (zł)',
    'Limit zwrotu (zł)',
    'Okres rozliczeniowy (miesiące)',
  ],
  plEquipment.map(
    (r) =>
      `| ${r.code} | ${r.name} | ${plMoney(r.list)} | ${plMoney(r.cap)} | ${r.period} |`,
  ),
)}

Wnioski o zwrot rozpatruje Dział Zaopatrzenia w terminie 11 dni roboczych.
Kwoty powyżej limitu wymagają zgody Zarządu wyrażonej na piśmie.
`,
);

writeFileSync(
  `${DIR}/en-01-equipment-limits.md`,
  `# Thornbury Foundry Works Ltd

## Schedule 3 — reimbursement caps for workshop equipment

In force from 1 March 2026, replacing the 2024 edition of Schedule 3. The
reimbursement cap is the maximum the company refunds against an invoice; the
list price is given for information only and is never the basis of a
settlement.

${table(
  [
    'Item code',
    'Equipment',
    'List price (GBP)',
    'Reimbursement cap (GBP)',
    'Review period (months)',
  ],
  enEquipment.map(
    (r) =>
      `| ${r.code} | ${r.name} | ${enMoney(r.list)} | ${enMoney(r.cap)} | ${r.period} |`,
  ),
)}

Claims are assessed by the Procurement Office within 9 working days. Anything
above a cap needs written Board approval.
`,
);

writeFileSync(
  `${DIR}/pl-02-stawki-serwisowe.md`,
  `# Zakłady Metalurgiczne „Czarny Dunajec" sp. z o.o.

## Cennik usług serwisowych świadczonych podmiotom zewnętrznym

Stawki obowiązują od 1 kwietnia 2026 r. Stawka podstawowa dotyczy prac
wykonywanych w dni robocze w godzinach 6:00–18:00. Stawka poza godzinami
obejmuje soboty, niedziele oraz prace nocne i jest rozliczana odrębnie.

${table(
  [
    'Kod usługi',
    'Nazwa usługi',
    'Stawka podstawowa (zł/h)',
    'Stawka poza godzinami (zł/h)',
    'Minimalny czas rozliczenia (h)',
  ],
  plServices.map(
    (r) =>
      `| ${r.code} | ${r.name} | ${plMoney(r.base)} | ${plMoney(r.oob)} | ${r.min} |`,
  ),
)}

Do każdej usługi rozliczanej poza godzinami dolicza się ryczałt dojazdowy
w wysokości 87,40 zł niezależnie od liczby przepracowanych godzin.
`,
);

writeFileSync(
  `${DIR}/en-02-service-rates.md`,
  `# Thornbury Foundry Works Ltd

## Price list for subcontracted machining and inspection services

Rates apply from 1 April 2026. The standard rate covers weekdays between 06:00
and 18:00. The out-of-hours rate covers Saturdays, Sundays and night work and
is invoiced separately.

${table(
  [
    'Service code',
    'Service',
    'Standard rate (GBP/h)',
    'Out-of-hours rate (GBP/h)',
    'Minimum billed time (h)',
  ],
  enServices.map(
    (r) =>
      `| ${r.code} | ${r.name} | ${enMoney(r.base)} | ${enMoney(r.oob)} | ${r.min} |`,
  ),
)}

Every out-of-hours job carries a fixed call-out charge of GBP 20.40 regardless
of the hours worked.
`,
);

const ALLOYS = [
  'GX6CrNiMo18-10',
  'EN-GJS-500-7',
  'AlSi10Mg',
  'GX40CrNiSi25-20',
  'EN-GJL-250',
  'CuSn12',
  'GX2CrNiMoN22-5-3',
  'EN-GJS-400-15',
  'AlMg5Si2Mn',
  'GX4CrNi13-4',
  'EN-GJL-300',
  'CuZn39Pb3',
  'GX8CrNi12',
  'EN-GJS-600-3',
  'AlSi7Mg0,3',
  'GX3CrNiMoCuN24-6-5',
  'EN-GJMW-400-5',
  'CuAl10Ni5Fe4',
  'GX5CrNiNb19-11',
  'EN-GJS-700-2',
  'AlCu4MgSi',
  'GX23CrMoV12-1',
  'EN-GJL-350',
  'CuNi10Fe1Mn',
  'GX12Cr12',
  'EN-GJS-450-10',
  'AlZn5Mg3Cu',
  'GX7CrNiMoCuNb18-18',
  'EN-GJMB-650-2',
  'CuSn10Zn2',
  'GX15CrNi25-20',
  'EN-GJS-800-1',
  'AlMg3Si',
  'GX2NiCrMo28-20-2',
  'EN-GJL-200',
  'CuZn33Pb2',
  'GX10CrNiSi18-9',
  'EN-GJS-350-22',
  'AlSi12Cu1',
  'GX4NiCrCuMo30-20-4',
  'EN-GJMW-350-4',
  'CuSn5Zn5Pb5',
  'GX20Cr14',
  'EN-GJS-900-2',
  'AlMg9',
  'GX6CrNiN26-7',
  'EN-GJL-150',
  'CuNi30Mn1Fe',
  'GX25CrMo4',
  'EN-GJS-550-5',
];
const sheetRows = [
  [
    'Numer partii',
    'Stop',
    'Masa wsadu (kg)',
    'Temperatura odlewania (C)',
    'Uzysk (%)',
    'Koszt jednostkowy (zl/kg)',
    'Data wytopu',
  ],
];
ALLOYS.forEach((alloy, i) => {
  const day = (i % 28) + 1;
  sheetRows.push([
    `WT-${3101 + i}`,
    alloy,
    String(520 + Math.round(rand() * 2400)),
    String(680 + Math.round(rand() * 900)),
    (82 + Math.round(rand() * 140) / 10).toFixed(1).replace('.', ','),
    (9 + Math.round(rand() * 5600) / 100).toFixed(2).replace('.', ','),
    `2026-0${1 + Math.floor(i / 28)}-${String(day).padStart(2, '0')}`,
  ]);
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet(sheetRows),
  'Wytopy 2026',
);
XLSX.writeFile(wb, `${DIR}/pl-03-rejestr-wytopow.xlsx`);

/**
 * A figure is usable in a question only if its digits appear in exactly one
 * place **in its own document**.
 *
 * `normalizeDigits` in the grader reduces both sides of a comparison to their
 * digits, so a short expectation matches inside a longer number. Four digits is
 * the floor — an hourly rate in GBP cannot be made longer without becoming
 * implausible — and the realistic
 * collision space is the document the answer was drawn from — that is where
 * every figure an answer might quote comes from — so uniqueness is checked
 * there rather than across the whole corpus, which would reject almost
 * everything and for no reason that can affect a grade.
 */
const digitsOf = (value) => String(value).replace(/[^0-9]/g, '');

const docFigures = {
  plEquipment: plEquipment.flatMap((r) => [plMoney(r.list), plMoney(r.cap)]),
  enEquipment: enEquipment.flatMap((r) => [enMoney(r.list), enMoney(r.cap)]),
  plServices: plServices.flatMap((r) => [plMoney(r.base), plMoney(r.oob)]),
  enServices: enServices.flatMap((r) => [enMoney(r.base), enMoney(r.oob)]),
  sheet: sheetRows.slice(1).flatMap((r) => [r[2], r[3], r[4], r[5]]),
};

const unique = (doc) => {
  const digits = docFigures[doc].map(digitsOf);
  return (value) => {
    const d = digitsOf(value);
    return (
      d.length >= 4 &&
      digits.filter((other) => other.includes(d) || d.includes(other))
        .length === 1
    );
  };
};

const pick = (doc, rows, from, render) => {
  const usable = unique(doc);
  for (let i = from; i < rows.length; i += 1) {
    if (render(rows[i]).every(usable)) {
      return { index: i, ...rows[i] };
    }
  }
  throw new Error(`no usable ${doc} row past index ${from}`);
};

const pickSheet = (from) => {
  const usable = unique('sheet');
  for (let j = from; j < sheetRows.length; j += 1) {
    if (usable(sheetRows[j][5]) && usable(sheetRows[j][2])) {
      return { index: j, row: sheetRows[j] };
    }
  }
  throw new Error(`no usable sheet row past ${from}`);
};

console.log(
  JSON.stringify(
    {
      plEquipment: [
        pick('plEquipment', plEquipment, 48, (r) => [
          plMoney(r.list),
          plMoney(r.cap),
        ]),
        pick('plEquipment', plEquipment, 55, (r) => [
          plMoney(r.list),
          plMoney(r.cap),
        ]),
      ],
      enEquipment: [
        pick('enEquipment', enEquipment, 48, (r) => [
          enMoney(r.list),
          enMoney(r.cap),
        ]),
        pick('enEquipment', enEquipment, 55, (r) => [
          enMoney(r.list),
          enMoney(r.cap),
        ]),
      ],
      plServices: [
        pick('plServices', plServices, 40, (r) => [
          plMoney(r.base),
          plMoney(r.oob),
        ]),
        pick('plServices', plServices, 45, (r) => [
          plMoney(r.base),
          plMoney(r.oob),
        ]),
      ],
      enServices: [
        pick('enServices', enServices, 40, (r) => [
          enMoney(r.base),
          enMoney(r.oob),
        ]),
        pick('enServices', enServices, 45, (r) => [
          enMoney(r.base),
          enMoney(r.oob),
        ]),
      ],
      sheet: [pickSheet(40), pickSheet(46)],
      counts: {
        equipmentRows: plEquipment.length,
        serviceRows: plServices.length,
        sheetRows: sheetRows.length - 1,
      },
    },
    null,
    2,
  ),
);
