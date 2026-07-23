export const smeltingRules = {
  "schemaVersion": 1,
  "ruleSet": "nicechunk-smelting-v1",
  "heatTiers": [
    {
      "tier": 0,
      "key": "ambient",
      "temperatureC": 20
    },
    {
      "tier": 1,
      "key": "low",
      "temperatureC": 350
    },
    {
      "tier": 2,
      "key": "workshop",
      "temperatureC": 700
    },
    {
      "tier": 3,
      "key": "forge",
      "temperatureC": 1050
    },
    {
      "tier": 4,
      "key": "blast",
      "temperatureC": 1300
    }
  ],
  "fuels": [
    {
      "id": "dry_grass",
      "sourceType": "raw",
      "sourceKeys": [
        "dryGrass",
        "deadBush",
        "thorn"
      ],
      "heatTier": 1,
      "burnSeconds": 18,
      "consumable": true
    },
    {
      "id": "wood",
      "sourceType": "raw",
      "sourceKeys": [
        "trunk",
        "pineTrunk",
        "deadWood",
        "giantRoot"
      ],
      "heatTier": 2,
      "burnSeconds": 42,
      "consumable": true
    },
    {
      "id": "charcoal",
      "sourceType": "material",
      "materialId": "charcoal",
      "heatTier": 2,
      "burnSeconds": 64,
      "consumable": true
    },
    {
      "id": "coal",
      "sourceType": "raw",
      "sourceKeys": [
        "coal"
      ],
      "heatTier": 3,
      "burnSeconds": 96,
      "consumable": true
    },
    {
      "id": "lava_heat",
      "sourceType": "raw",
      "sourceKeys": [
        "lava",
        "basalt"
      ],
      "heatTier": 4,
      "burnSeconds": 160,
      "consumable": false
    }
  ],
  "materials": [
    {
      "id": "charcoal",
      "class": "carbon",
      "rawInputs": [
        {
          "key": "trunk",
          "amount": 2
        },
        {
          "key": "dryGrass",
          "amount": 3
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "fuel",
      "composition": [
        [
          "C",
          "70-88%"
        ],
        [
          "O",
          "6-18%"
        ],
        [
          "H",
          "2-6%"
        ],
        [
          "K",
          "0.2-2%"
        ]
      ]
    },
    {
      "id": "biochar_compost",
      "class": "carbon",
      "rawInputs": [
        {
          "key": "leaves",
          "amount": 2
        },
        {
          "key": "moss",
          "amount": 1
        },
        {
          "key": "mud",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 2,
      "forgeUse": "soilCatalyst",
      "composition": [
        [
          "C",
          "32-52%"
        ],
        [
          "O",
          "24-38%"
        ],
        [
          "H",
          "4-9%"
        ],
        [
          "N",
          "1-5%"
        ],
        [
          "K",
          "0.5-4%"
        ]
      ]
    },
    {
      "id": "resin_binder",
      "class": "polymer",
      "rawInputs": [
        {
          "key": "pineTrunk",
          "amount": 1
        },
        {
          "key": "vine",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "binding",
      "composition": [
        [
          "C",
          "58-72%"
        ],
        [
          "H",
          "7-11%"
        ],
        [
          "O",
          "12-24%"
        ],
        [
          "N",
          "0.2-2%"
        ]
      ]
    },
    {
      "id": "ceramic_brick",
      "class": "ceramic",
      "rawInputs": [
        {
          "key": "clay",
          "amount": 2
        },
        {
          "key": "sand",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 1,
      "yieldCount": 2,
      "forgeUse": "mold",
      "composition": [
        [
          "O",
          "46-56%"
        ],
        [
          "Si",
          "22-36%"
        ],
        [
          "Al",
          "6-16%"
        ],
        [
          "Fe",
          "0.5-6%"
        ]
      ]
    },
    {
      "id": "lime_ceramic",
      "class": "ceramic",
      "rawInputs": [
        {
          "key": "shellBed",
          "amount": 1
        },
        {
          "key": "clay",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "binding",
      "composition": [
        [
          "O",
          "42-54%"
        ],
        [
          "Ca",
          "18-34%"
        ],
        [
          "Si",
          "10-24%"
        ],
        [
          "Al",
          "3-10%"
        ]
      ]
    },
    {
      "id": "quicklime",
      "class": "ceramic",
      "rawInputs": [
        {
          "key": "shellBed",
          "amount": 2
        },
        {
          "key": "coral",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "flux",
      "composition": [
        [
          "Ca",
          "42-58%"
        ],
        [
          "O",
          "32-45%"
        ],
        [
          "C",
          "0-8%"
        ],
        [
          "Mg",
          "0.5-4%"
        ]
      ]
    },
    {
      "id": "salt_flux",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "saltFlat",
          "amount": 2
        },
        {
          "key": "ash",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "flux",
      "composition": [
        [
          "Na",
          "24-38%"
        ],
        [
          "Cl",
          "28-42%"
        ],
        [
          "K",
          "2-8%"
        ],
        [
          "O",
          "8-20%"
        ]
      ]
    },
    {
      "id": "ash_cement",
      "class": "composite",
      "rawInputs": [
        {
          "key": "ash",
          "amount": 2
        },
        {
          "key": "clay",
          "amount": 1
        },
        {
          "key": "shellBed",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 2,
      "yieldCount": 2,
      "forgeUse": "masonry",
      "composition": [
        [
          "O",
          "42-55%"
        ],
        [
          "Si",
          "16-30%"
        ],
        [
          "Ca",
          "8-20%"
        ],
        [
          "Al",
          "4-12%"
        ],
        [
          "Fe",
          "1-6%"
        ]
      ]
    },
    {
      "id": "glass_ingot",
      "class": "glass",
      "rawInputs": [
        {
          "key": "sand",
          "amount": 3
        },
        {
          "key": "saltFlat",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 1,
      "forgeUse": "lens",
      "composition": [
        [
          "Si",
          "30-44%"
        ],
        [
          "O",
          "48-58%"
        ],
        [
          "Na",
          "3-10%"
        ],
        [
          "Ca",
          "1-6%"
        ]
      ]
    },
    {
      "id": "obsidian_glass",
      "class": "glass",
      "rawInputs": [
        {
          "key": "sand",
          "amount": 2
        },
        {
          "key": "basalt",
          "amount": 1
        }
      ],
      "catalysts": [
        {
          "key": "lava",
          "amount": 1
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "lens",
      "composition": [
        [
          "Si",
          "26-40%"
        ],
        [
          "O",
          "42-54%"
        ],
        [
          "Fe",
          "3-10%"
        ],
        [
          "Mg",
          "1-7%"
        ],
        [
          "Al",
          "4-12%"
        ]
      ]
    },
    {
      "id": "silicon_wafer",
      "class": "crystal",
      "rawInputs": [
        {
          "key": "sand",
          "amount": 4
        },
        {
          "key": "coal",
          "amount": 1
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "circuit",
      "composition": [
        [
          "Si",
          "78-92%"
        ],
        [
          "O",
          "3-12%"
        ],
        [
          "C",
          "0.5-4%"
        ],
        [
          "Al",
          "0.1-2%"
        ]
      ]
    },
    {
      "id": "ice_crystal",
      "class": "crystal",
      "rawInputs": [
        {
          "key": "ice",
          "amount": 2
        },
        {
          "key": "snow",
          "amount": 2
        },
        {
          "key": "saltFlat",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "forgeUse": "cooling",
      "composition": [
        [
          "O",
          "82-89%"
        ],
        [
          "H",
          "10-12%"
        ],
        [
          "Na",
          "0.2-2%"
        ],
        [
          "Cl",
          "0.2-2%"
        ]
      ]
    },
    {
      "id": "iron_bloom",
      "class": "metal",
      "rawInputs": [
        {
          "key": "deepStone",
          "amount": 3
        },
        {
          "key": "stone",
          "amount": 1
        }
      ],
      "catalysts": [
        {
          "key": "coal",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 1,
      "forgeUse": "toolHead",
      "composition": [
        [
          "Fe",
          "54-74%"
        ],
        [
          "O",
          "8-18%"
        ],
        [
          "C",
          "0.2-3%"
        ],
        [
          "Si",
          "2-10%"
        ],
        [
          "Mn",
          "0-2%"
        ]
      ]
    },
    {
      "id": "copper_bloom",
      "class": "metal",
      "rawInputs": [
        {
          "key": "gravel",
          "amount": 2
        },
        {
          "key": "basalt",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 1,
      "forgeUse": "conductor",
      "composition": [
        [
          "Cu",
          "42-68%"
        ],
        [
          "Fe",
          "4-14%"
        ],
        [
          "Si",
          "4-14%"
        ],
        [
          "O",
          "8-22%"
        ]
      ]
    },
    {
      "id": "alumina_plate",
      "class": "ceramic",
      "rawInputs": [
        {
          "key": "clay",
          "amount": 3
        },
        {
          "key": "deepStone",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 1,
      "forgeUse": "armorPlate",
      "composition": [
        [
          "Al",
          "22-38%"
        ],
        [
          "O",
          "42-54%"
        ],
        [
          "Si",
          "8-18%"
        ],
        [
          "Fe",
          "1-6%"
        ]
      ]
    },
    {
      "id": "nickel_iron",
      "class": "alloy",
      "rawInputs": [
        {
          "key": "deepStone",
          "amount": 3
        },
        {
          "key": "basalt",
          "amount": 2
        }
      ],
      "catalysts": [
        {
          "key": "coal",
          "amount": 1
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "magneticCore",
      "composition": [
        [
          "Fe",
          "48-68%"
        ],
        [
          "Ni",
          "6-18%"
        ],
        [
          "Mg",
          "2-8%"
        ],
        [
          "C",
          "0.2-3%"
        ],
        [
          "Si",
          "2-10%"
        ]
      ]
    },
    {
      "id": "carbon_plate",
      "class": "carbon",
      "rawInputs": [
        {
          "key": "coal",
          "amount": 2
        },
        {
          "key": "deepStone",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 1,
      "forgeUse": "reinforcement",
      "composition": [
        [
          "C",
          "62-82%"
        ],
        [
          "Fe",
          "3-12%"
        ],
        [
          "Si",
          "2-8%"
        ],
        [
          "O",
          "4-14%"
        ]
      ]
    },
    {
      "id": "carbon_steel",
      "class": "alloy",
      "rawInputs": [
        {
          "key": "deepStone",
          "amount": 4
        },
        {
          "key": "coal",
          "amount": 2
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "weaponAndTool",
      "composition": [
        [
          "Fe",
          "78-92%"
        ],
        [
          "C",
          "0.6-2.2%"
        ],
        [
          "Mn",
          "0-2%"
        ],
        [
          "Si",
          "0.2-2%"
        ]
      ]
    },
    {
      "id": "basalt_fiber",
      "class": "fiber",
      "rawInputs": [
        {
          "key": "basalt",
          "amount": 3
        },
        {
          "key": "lava",
          "amount": 1
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 2,
      "forgeUse": "heatShield",
      "composition": [
        [
          "Si",
          "18-30%"
        ],
        [
          "O",
          "42-54%"
        ],
        [
          "Mg",
          "4-12%"
        ],
        [
          "Fe",
          "4-12%"
        ],
        [
          "Ca",
          "4-10%"
        ]
      ]
    },
    {
      "id": "basalt_composite",
      "class": "composite",
      "rawInputs": [
        {
          "key": "basalt",
          "amount": 3
        },
        {
          "key": "pineTrunk",
          "amount": 1
        },
        {
          "key": "coal",
          "amount": 1
        }
      ],
      "requiredHeatTier": 4,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "armorPlate",
      "composition": [
        [
          "Si",
          "14-24%"
        ],
        [
          "O",
          "34-48%"
        ],
        [
          "C",
          "18-32%"
        ],
        [
          "Mg",
          "2-8%"
        ],
        [
          "Fe",
          "2-8%"
        ]
      ]
    },
    {
      "id": "geopolymer_block",
      "class": "composite",
      "rawInputs": [
        {
          "key": "ash",
          "amount": 2
        },
        {
          "key": "basalt",
          "amount": 1
        },
        {
          "key": "saltFlat",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 2,
      "yieldCount": 2,
      "forgeUse": "masonry",
      "composition": [
        [
          "O",
          "42-55%"
        ],
        [
          "Si",
          "20-34%"
        ],
        [
          "Al",
          "5-14%"
        ],
        [
          "Na",
          "1-6%"
        ],
        [
          "Ca",
          "1-7%"
        ]
      ]
    },
    {
      "id": "coral_lime",
      "class": "ceramic",
      "rawInputs": [
        {
          "key": "coral",
          "amount": 2
        },
        {
          "key": "deadCoral",
          "amount": 1
        },
        {
          "key": "sand",
          "amount": 1
        }
      ],
      "requiredHeatTier": 2,
      "artisanLevel": 2,
      "yieldCount": 2,
      "forgeUse": "masonry",
      "composition": [
        [
          "Ca",
          "24-42%"
        ],
        [
          "O",
          "38-52%"
        ],
        [
          "Si",
          "8-18%"
        ],
        [
          "C",
          "1-8%"
        ]
      ]
    },
    {
      "id": "toxic_glass",
      "class": "glass",
      "rawInputs": [
        {
          "key": "sand",
          "amount": 2
        },
        {
          "key": "toxicWater",
          "amount": 1
        },
        {
          "key": "saltFlat",
          "amount": 1
        }
      ],
      "requiredHeatTier": 3,
      "artisanLevel": 3,
      "yieldCount": 1,
      "forgeUse": "sealedVessel",
      "composition": [
        [
          "Si",
          "24-38%"
        ],
        [
          "O",
          "44-56%"
        ],
        [
          "Na",
          "3-10%"
        ],
        [
          "Cl",
          "1-6%"
        ],
        [
          "S",
          "0.5-4%"
        ]
      ]
    },
    {
      "id": "cotton_cloth",
      "class": "fiber",
      "rawInputs": [
        {
          "key": "cotton",
          "amount": 4
        },
        {
          "key": "dryGrass",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 2,
      "yieldCount": 1,
      "unitVolumeMm3": 1000000,
      "forgeUse": "fabric",
      "renderMode": "cloth",
      "composition": [
        [
          "C",
          "42-48%"
        ],
        [
          "O",
          "40-46%"
        ],
        [
          "H",
          "5-7%"
        ],
        [
          "N",
          "0.1-1%"
        ]
      ]
    },
    {
      "id": "white_dye",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "flowerWhite",
          "amount": 2
        },
        {
          "key": "water",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "unitVolumeMm3": 20000,
      "forgeUse": "dye",
      "dyeColor": "#f4f6ee",
      "composition": [
        [
          "O",
          "42-54%"
        ],
        [
          "C",
          "28-40%"
        ],
        [
          "H",
          "4-8%"
        ],
        [
          "Ca",
          "2-8%"
        ]
      ]
    },
    {
      "id": "yellow_dye",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "flowerYellow",
          "amount": 2
        },
        {
          "key": "water",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "unitVolumeMm3": 20000,
      "forgeUse": "dye",
      "dyeColor": "#eec436",
      "composition": [
        [
          "C",
          "48-62%"
        ],
        [
          "O",
          "26-38%"
        ],
        [
          "H",
          "5-9%"
        ],
        [
          "N",
          "0.5-3%"
        ]
      ]
    },
    {
      "id": "red_dye",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "flowerRed",
          "amount": 2
        },
        {
          "key": "water",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "unitVolumeMm3": 20000,
      "forgeUse": "dye",
      "dyeColor": "#cc4f46",
      "composition": [
        [
          "C",
          "50-64%"
        ],
        [
          "O",
          "24-36%"
        ],
        [
          "H",
          "5-9%"
        ],
        [
          "N",
          "0.5-3%"
        ]
      ]
    },
    {
      "id": "blue_dye",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "flowerBlue",
          "amount": 2
        },
        {
          "key": "water",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "unitVolumeMm3": 20000,
      "forgeUse": "dye",
      "dyeColor": "#5288da",
      "composition": [
        [
          "C",
          "46-60%"
        ],
        [
          "O",
          "26-40%"
        ],
        [
          "H",
          "5-9%"
        ],
        [
          "N",
          "1-4%"
        ]
      ]
    },
    {
      "id": "pink_dye",
      "class": "chemical",
      "rawInputs": [
        {
          "key": "flowerPink",
          "amount": 2
        },
        {
          "key": "water",
          "amount": 1
        }
      ],
      "requiredHeatTier": 1,
      "artisanLevel": 1,
      "yieldCount": 1,
      "unitVolumeMm3": 20000,
      "forgeUse": "dye",
      "dyeColor": "#e287b2",
      "composition": [
        [
          "C",
          "48-62%"
        ],
        [
          "O",
          "26-40%"
        ],
        [
          "H",
          "5-9%"
        ],
        [
          "N",
          "0.5-3%"
        ]
      ]
    }
  ]
};


export const SMELTING_MATERIAL_ATTRIBUTE_KEYS = [
  "hardness",
  "durability",
  "toughness",
  "ductility",
  "brittleness",
  "density",
  "heatResistance",
  "corrosionResistance",
  "conductivity",
  "thermalConductivity",
  "magnetism",
  "workability",
];

const BUILDING_ATTRIBUTE_BASES = Object.freeze({
  wood: Object.freeze({ hardness: 32, durability: 64, toughness: 70, ductility: 34, brittleness: 24, density: 46, heatResistance: 34, corrosionResistance: 44, conductivity: 3, thermalConductivity: 7, magnetism: 0, workability: 90 }),
  glass: Object.freeze({ hardness: 68, durability: 52, toughness: 24, ductility: 1, brittleness: 86, density: 62, heatResistance: 62, corrosionResistance: 94, conductivity: 4, thermalConductivity: 17, magnetism: 0, workability: 24 }),
  ceramic: Object.freeze({ hardness: 68, durability: 66, toughness: 36, ductility: 2, brittleness: 72, density: 55, heatResistance: 82, corrosionResistance: 84, conductivity: 6, thermalConductivity: 22, magnetism: 0, workability: 38 }),
  stone: Object.freeze({ hardness: 72, durability: 78, toughness: 52, ductility: 1, brittleness: 58, density: 65, heatResistance: 84, corrosionResistance: 80, conductivity: 7, thermalConductivity: 30, magnetism: 2, workability: 34 }),
  composite: Object.freeze({ hardness: 58, durability: 72, toughness: 58, ductility: 8, brittleness: 44, density: 52, heatResistance: 66, corrosionResistance: 72, conductivity: 6, thermalConductivity: 18, magnetism: 0, workability: 58 }),
  crystal: Object.freeze({ hardness: 42, durability: 36, toughness: 18, ductility: 1, brittleness: 82, density: 54, heatResistance: 42, corrosionResistance: 24, conductivity: 18, thermalConductivity: 34, magnetism: 0, workability: 22 }),
});

const BUILDING_COMPOSITIONS = Object.freeze({
  wood: Object.freeze([["C", "44-51%"], ["O", "40-46%"], ["H", "5-7%"], ["N", "0.1-0.5%"]]),
  glass: Object.freeze([["O", "52-58%"], ["Si", "30-36%"], ["Na", "6-10%"], ["Ca", "3-7%"], ["Al", "0.5-3%"]]),
  clay: Object.freeze([["O", "46-54%"], ["Si", "24-34%"], ["Al", "7-15%"], ["Fe", "1-7%"], ["Ca", "0.5-5%"]]),
  stone: Object.freeze([["O", "44-52%"], ["Si", "22-34%"], ["Ca", "4-18%"], ["Al", "3-10%"], ["Fe", "1-8%"]]),
  basalt: Object.freeze([["O", "43-49%"], ["Si", "21-27%"], ["Fe", "7-13%"], ["Al", "6-10%"], ["Ca", "5-10%"], ["Mg", "3-8%"]]),
  lime: Object.freeze([["O", "43-50%"], ["Ca", "28-39%"], ["Si", "5-15%"], ["C", "2-8%"], ["Al", "1-5%"]]),
  salt: Object.freeze([["Cl", "56-61%"], ["Na", "37-40%"], ["O", "0-3%"], ["Ca", "0-2%"]]),
});

const BUILDING_VOXEL_VOLUME_MM3 = 1_000_000;

export const BUILDING_MATERIAL_DIMENSIONS_VU = Object.freeze({
  55: Object.freeze([1, 0.08, 0.25]),
  56: Object.freeze([1, 0.07, 0.07]),
  57: Object.freeze([1, 0.22, 0.22]),
  58: Object.freeze([1, 1, 0.06]),
  59: Object.freeze([1, 1, 0.06]),
  60: Object.freeze([1, 1, 0.06]),
  61: Object.freeze([1, 1, 0.06]),
  62: Object.freeze([0.5, 0.25, 0.25]),
  63: Object.freeze([0.5, 0.25, 0.25]),
  64: Object.freeze([0.5, 0.25, 0.25]),
  65: Object.freeze([0.5, 0.25, 0.25]),
  66: Object.freeze([0.5, 0.25, 0.25]),
  67: Object.freeze([1, 0.5, 0.5]),
  68: Object.freeze([1, 0.5, 0.5]),
  69: Object.freeze([1, 0.12, 0.5]),
  70: Object.freeze([1, 1, 0.08]),
  71: Object.freeze([1, 1, 0.08]),
  72: Object.freeze([1, 1, 0.5]),
  73: Object.freeze([1, 0.1, 1]),
  74: Object.freeze([0.5, 0.04, 0.5]),
  75: Object.freeze([0.5, 0.04, 0.5]),
  76: Object.freeze([1, 0.5, 0.5]),
  77: Object.freeze([1, 0.5, 0.5]),
  96: Object.freeze([1, 0.08, 0.5]),
  97: Object.freeze([1, 0.08, 0.5]),
  98: Object.freeze([1, 0.08, 0.5]),
  99: Object.freeze([1, 0.08, 0.5]),
  100: Object.freeze([1, 0.08, 0.5]),
  101: Object.freeze([1, 0.08, 0.5]),
});

export const BUILDING_MATERIAL_RULES = Object.freeze([
  buildingMaterialRule({
    id: "wooden_plank", buildingMaterialId: 55, className: "wood", inputs: [["trunk", 1]],
    processType: "carpentry", station: "sawbench", processSeconds: 12, yieldCount: 4, yieldBps: 9500,
    densityKgM3: 550, thermalConductivityWMK: 0.13, waterAbsorptionPct: 12, compressiveStrengthMpa: 35, flexuralStrengthMpa: 70,
    composition: "wood", attributes: { durability: 68, workability: 96 },
  }),
  buildingMaterialRule({
    id: "wooden_stick", buildingMaterialId: 56, className: "wood", inputs: [["material:wooden_plank", 2]],
    processType: "carpentry", station: "carpenters_bench", processSeconds: 6, yieldCount: 4, yieldBps: 9800,
    densityKgM3: 550, thermalConductivityWMK: 0.13, waterAbsorptionPct: 12, compressiveStrengthMpa: 32, flexuralStrengthMpa: 64,
    composition: "wood", attributes: { hardness: 28, toughness: 66, workability: 98 },
  }),
  buildingMaterialRule({
    id: "squared_timber", buildingMaterialId: 57, className: "wood", inputs: [["trunk", 1]],
    processType: "carpentry", station: "sawbench", processSeconds: 18, yieldCount: 1, yieldBps: 8800,
    densityKgM3: 520, thermalConductivityWMK: 0.12, waterAbsorptionPct: 14, compressiveStrengthMpa: 40, flexuralStrengthMpa: 75,
    composition: "wood", attributes: { hardness: 38, durability: 76, toughness: 78, workability: 84 },
  }),
  buildingMaterialRule({
    id: "clear_glass_panel", buildingMaterialId: 58, className: "glass", inputs: [["sand", 4], ["ash", 1], ["material:salt_flux", 1]],
    requiredHeatTier: 4, temperatureC: 1250, processType: "glassmaking", station: "glass_furnace", processSeconds: 64, yieldCount: 4, yieldBps: 9200, artisanLevel: 3,
    densityKgM3: 2500, thermalConductivityWMK: 1.0, waterAbsorptionPct: 0, compressiveStrengthMpa: 1000, flexuralStrengthMpa: 45,
    composition: "glass", attributes: { corrosionResistance: 98, workability: 22 },
  }),
  buildingMaterialRule({
    id: "ice_blue_glass_panel", buildingMaterialId: 59, className: "glass", inputs: [["material:clear_glass_panel", 4], ["material:ice_crystal", 1], ["material:salt_flux", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glassmaking", station: "glass_furnace", processSeconds: 48, yieldCount: 4, yieldBps: 9400, artisanLevel: 3,
    densityKgM3: 2520, thermalConductivityWMK: 0.95, waterAbsorptionPct: 0, compressiveStrengthMpa: 980, flexuralStrengthMpa: 46,
    composition: "glass", attributes: { heatResistance: 58, corrosionResistance: 98, thermalConductivity: 15 },
  }),
  buildingMaterialRule({
    id: "amber_glass_panel", buildingMaterialId: 60, className: "glass", inputs: [["material:clear_glass_panel", 4], ["coal", 1], ["sand", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glassmaking", station: "glass_furnace", processSeconds: 46, yieldCount: 4, yieldBps: 9300, artisanLevel: 3,
    densityKgM3: 2520, thermalConductivityWMK: 1.0, waterAbsorptionPct: 0, compressiveStrengthMpa: 970, flexuralStrengthMpa: 44,
    composition: "glass", attributes: { corrosionResistance: 96, workability: 26 },
  }),
  buildingMaterialRule({
    id: "basalt_reinforced_glass", buildingMaterialId: 61, className: "composite", inputs: [["material:clear_glass_panel", 4], ["material:basalt_fiber", 1], ["material:resin_binder", 1]],
    processType: "lamination", station: "lamination_press", processSeconds: 42, yieldCount: 4, yieldBps: 9000, artisanLevel: 3,
    densityKgM3: 2600, thermalConductivityWMK: 0.85, waterAbsorptionPct: 0.1, compressiveStrengthMpa: 1050, flexuralStrengthMpa: 120,
    composition: "basalt", attributes: { hardness: 78, durability: 86, toughness: 72, brittleness: 48, heatResistance: 82, corrosionResistance: 92, workability: 28 },
  }),
  buildingMaterialRule({
    id: "fired_clay_brick", buildingMaterialId: 62, className: "ceramic", inputs: [["clay", 4], ["sand", 1]],
    requiredHeatTier: 3, temperatureC: 850, processType: "kiln", station: "kiln", processSeconds: 54, yieldCount: 4, yieldBps: 9000, artisanLevel: 2,
    densityKgM3: 1800, thermalConductivityWMK: 0.7, waterAbsorptionPct: 12, compressiveStrengthMpa: 25, flexuralStrengthMpa: 4,
    composition: "clay", attributes: { hardness: 64, durability: 68, heatResistance: 86, workability: 48 },
  }),
  buildingMaterialRule({
    id: "adobe_brick", buildingMaterialId: 63, className: "composite", inputs: [["mud", 3], ["dryDirt", 1], ["dryGrass", 1]],
    processType: "drying", station: "drying_rack", processSeconds: 90, yieldCount: 4, yieldBps: 8600,
    densityKgM3: 1700, thermalConductivityWMK: 0.6, waterAbsorptionPct: 20, compressiveStrengthMpa: 3, flexuralStrengthMpa: 0.5,
    composition: "clay", attributes: { hardness: 28, durability: 44, toughness: 38, brittleness: 42, heatResistance: 48, corrosionResistance: 24, workability: 82 },
  }),
  buildingMaterialRule({
    id: "stone_brick", buildingMaterialId: 64, className: "stone", inputs: [["stone", 4]],
    processType: "masonry", station: "masons_bench", processSeconds: 18, yieldCount: 4, yieldBps: 9600,
    densityKgM3: 2400, thermalConductivityWMK: 2.0, waterAbsorptionPct: 3, compressiveStrengthMpa: 100, flexuralStrengthMpa: 10,
    composition: "stone", attributes: { hardness: 74, durability: 82, workability: 46 },
  }),
  buildingMaterialRule({
    id: "deep_stone_brick", buildingMaterialId: 65, className: "stone", inputs: [["deepStone", 4]],
    processType: "masonry", station: "masons_bench", processSeconds: 24, yieldCount: 4, yieldBps: 9400, artisanLevel: 2,
    densityKgM3: 2700, thermalConductivityWMK: 2.5, waterAbsorptionPct: 1.5, compressiveStrengthMpa: 160, flexuralStrengthMpa: 14,
    composition: "stone", attributes: { hardness: 84, durability: 90, toughness: 62, density: 72, heatResistance: 88, workability: 30 },
  }),
  buildingMaterialRule({
    id: "basalt_brick", buildingMaterialId: 66, className: "stone", inputs: [["basalt", 4]],
    processType: "masonry", station: "masons_bench", processSeconds: 28, yieldCount: 4, yieldBps: 9200, artisanLevel: 2,
    densityKgM3: 2900, thermalConductivityWMK: 1.7, waterAbsorptionPct: 1, compressiveStrengthMpa: 180, flexuralStrengthMpa: 16,
    composition: "basalt", attributes: { hardness: 88, durability: 92, toughness: 66, density: 76, heatResistance: 96, corrosionResistance: 88, workability: 26 },
  }),
  buildingMaterialRule({
    id: "sandstone_block", buildingMaterialId: 67, className: "stone", inputs: [["sand", 4], ["saltFlat", 1]],
    processType: "pressing", station: "stone_press", processSeconds: 20, yieldCount: 1, yieldBps: 9000,
    densityKgM3: 2200, thermalConductivityWMK: 1.7, waterAbsorptionPct: 6, compressiveStrengthMpa: 40, flexuralStrengthMpa: 5,
    composition: "stone", attributes: { hardness: 54, durability: 64, toughness: 42, brittleness: 66, workability: 66 },
  }),
  buildingMaterialRule({
    id: "cobblestone", buildingMaterialId: 68, className: "stone", inputs: [["stone", 3], ["gravel", 1]],
    processType: "masonry", station: "masons_bench", processSeconds: 10, yieldCount: 4, yieldBps: 9800,
    densityKgM3: 2500, thermalConductivityWMK: 2.1, waterAbsorptionPct: 4, compressiveStrengthMpa: 80, flexuralStrengthMpa: 8,
    composition: "stone", attributes: { hardness: 66, durability: 76, toughness: 58, workability: 54 },
  }),
  buildingMaterialRule({
    id: "polished_stone_slab", buildingMaterialId: 69, className: "stone", inputs: [["stone", 2], ["sand", 1]],
    processType: "polishing", station: "polishing_bench", processSeconds: 20, yieldCount: 2, yieldBps: 9400,
    densityKgM3: 2600, thermalConductivityWMK: 2.3, waterAbsorptionPct: 1.5, compressiveStrengthMpa: 130, flexuralStrengthMpa: 12,
    composition: "stone", attributes: { hardness: 78, durability: 84, corrosionResistance: 88, workability: 38 },
  }),
  buildingMaterialRule({
    id: "lime_plaster", buildingMaterialId: 70, className: "composite", inputs: [["material:quicklime", 2], ["ash", 1], ["water", 1]],
    processType: "mixing", station: "plaster_mixer", processSeconds: 32, yieldCount: 4, yieldBps: 9000,
    densityKgM3: 1600, thermalConductivityWMK: 0.7, waterAbsorptionPct: 15, compressiveStrengthMpa: 5, flexuralStrengthMpa: 1.5,
    composition: "lime", attributes: { hardness: 32, durability: 58, toughness: 36, corrosionResistance: 72, workability: 92 },
  }),
  buildingMaterialRule({
    id: "clay_plaster", buildingMaterialId: 71, className: "composite", inputs: [["clay", 2], ["sand", 1], ["water", 1], ["dryGrass", 1]],
    processType: "mixing", station: "plaster_mixer", processSeconds: 24, yieldCount: 4, yieldBps: 9200,
    densityKgM3: 1700, thermalConductivityWMK: 0.8, waterAbsorptionPct: 18, compressiveStrengthMpa: 3, flexuralStrengthMpa: 1,
    composition: "clay", attributes: { hardness: 26, durability: 48, toughness: 34, corrosionResistance: 46, workability: 94 },
  }),
  buildingMaterialRule({
    id: "rammed_earth", buildingMaterialId: 72, className: "composite", inputs: [["dryDirt", 3], ["gravel", 1], ["clay", 1]],
    processType: "compaction", station: "earth_rammer", processSeconds: 30, yieldCount: 1, yieldBps: 9600,
    densityKgM3: 1900, thermalConductivityWMK: 1.0, waterAbsorptionPct: 10, compressiveStrengthMpa: 4, flexuralStrengthMpa: 1,
    composition: "clay", attributes: { hardness: 40, durability: 62, toughness: 48, heatResistance: 62, corrosionResistance: 42, workability: 70 },
  }),
  buildingMaterialRule({
    id: "shell_terrazzo", buildingMaterialId: 73, className: "composite", inputs: [["shellBed", 2], ["stone", 2], ["material:quicklime", 1]],
    processType: "polishing", station: "polishing_bench", processSeconds: 36, yieldCount: 2, yieldBps: 9000, artisanLevel: 2,
    densityKgM3: 2400, thermalConductivityWMK: 1.6, waterAbsorptionPct: 1.5, compressiveStrengthMpa: 50, flexuralStrengthMpa: 7,
    composition: "lime", attributes: { hardness: 70, durability: 82, brittleness: 50, corrosionResistance: 86, workability: 46 },
  }),
  buildingMaterialRule({
    id: "white_ceramic_tile", buildingMaterialId: 74, className: "ceramic", inputs: [["clay", 4], ["material:lime_ceramic", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "kiln", station: "kiln", processSeconds: 48, yieldCount: 4, yieldBps: 9400, artisanLevel: 2,
    densityKgM3: 2200, thermalConductivityWMK: 1.2, waterAbsorptionPct: 0.5, compressiveStrengthMpa: 200, flexuralStrengthMpa: 35,
    composition: "clay", attributes: { hardness: 78, durability: 76, brittleness: 68, corrosionResistance: 94, workability: 34 },
  }),
  buildingMaterialRule({
    id: "blue_ceramic_tile", buildingMaterialId: 75, className: "ceramic", inputs: [["clay", 4], ["material:ice_crystal", 1], ["material:glass_ingot", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "kiln", station: "kiln", processSeconds: 50, yieldCount: 4, yieldBps: 9200, artisanLevel: 3,
    densityKgM3: 2250, thermalConductivityWMK: 1.25, waterAbsorptionPct: 0.4, compressiveStrengthMpa: 205, flexuralStrengthMpa: 36,
    composition: "glass", attributes: { hardness: 80, durability: 78, brittleness: 68, corrosionResistance: 96, workability: 32 },
  }),
  buildingMaterialRule({
    id: "volcanic_ash_concrete", buildingMaterialId: 76, className: "composite", inputs: [["ash", 2], ["basalt", 2], ["gravel", 1], ["water", 1]],
    processType: "mixing", station: "aggregate_mixer", processSeconds: 38, yieldCount: 2, yieldBps: 9300, artisanLevel: 2,
    densityKgM3: 2300, thermalConductivityWMK: 1.5, waterAbsorptionPct: 5, compressiveStrengthMpa: 45, flexuralStrengthMpa: 5,
    composition: "basalt", attributes: { hardness: 68, durability: 86, toughness: 64, heatResistance: 90, corrosionResistance: 82, workability: 48 },
  }),
  buildingMaterialRule({
    id: "salt_crystal_block", buildingMaterialId: 77, className: "crystal", inputs: [["saltFlat", 4], ["water", 1]],
    processType: "crystallization", station: "crystallizer", processSeconds: 72, yieldCount: 1, yieldBps: 8500,
    densityKgM3: 2160, thermalConductivityWMK: 6.0, waterAbsorptionPct: 0.1, compressiveStrengthMpa: 20, flexuralStrengthMpa: 2,
    composition: "salt", attributes: { hardness: 24, durability: 28, corrosionResistance: 12, conductivity: 30, thermalConductivity: 46, workability: 30 },
  }),
  buildingMaterialRule({
    id: "roof_tile_terracotta", buildingMaterialId: 96, className: "ceramic", inputs: [["clay", 4], ["sand", 1]],
    requiredHeatTier: 2, temperatureC: 700, processType: "kiln", station: "kiln", processSeconds: 58, yieldCount: 4, yieldBps: 7800, artisanLevel: 2,
    densityKgM3: 1900, thermalConductivityWMK: 0.8, waterAbsorptionPct: 8, compressiveStrengthMpa: 45, flexuralStrengthMpa: 15,
    composition: "clay", attributes: { hardness: 62, durability: 70, heatResistance: 84, corrosionResistance: 74, workability: 46 },
  }),
  buildingMaterialRule({
    id: "roof_tile_ice_blue", buildingMaterialId: 97, className: "ceramic", inputs: [["material:roof_tile_terracotta", 4], ["material:ice_crystal", 1], ["material:glass_ingot", 1], ["material:salt_flux", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glaze_firing", station: "kiln", processSeconds: 52, yieldCount: 4, yieldBps: 9400, artisanLevel: 3,
    densityKgM3: 2050, thermalConductivityWMK: 0.9, waterAbsorptionPct: 2, compressiveStrengthMpa: 60, flexuralStrengthMpa: 20,
    composition: "glass", attributes: { hardness: 72, durability: 80, heatResistance: 82, corrosionResistance: 92, workability: 34 },
  }),
  buildingMaterialRule({
    id: "roof_tile_shell_white", buildingMaterialId: 98, className: "ceramic", inputs: [["material:roof_tile_terracotta", 4], ["material:lime_ceramic", 1], ["material:glass_ingot", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glaze_firing", station: "kiln", processSeconds: 50, yieldCount: 4, yieldBps: 9300, artisanLevel: 3,
    densityKgM3: 2070, thermalConductivityWMK: 0.95, waterAbsorptionPct: 2, compressiveStrengthMpa: 62, flexuralStrengthMpa: 20,
    composition: "lime", attributes: { hardness: 72, durability: 80, heatResistance: 84, corrosionResistance: 90, workability: 34 },
  }),
  buildingMaterialRule({
    id: "roof_tile_charcoal", buildingMaterialId: 99, className: "ceramic", inputs: [["material:roof_tile_terracotta", 4], ["material:charcoal", 1], ["material:resin_binder", 1], ["material:glass_ingot", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glaze_firing", station: "kiln", processSeconds: 50, yieldCount: 4, yieldBps: 9200, artisanLevel: 3,
    densityKgM3: 2040, thermalConductivityWMK: 0.85, waterAbsorptionPct: 2, compressiveStrengthMpa: 58, flexuralStrengthMpa: 19,
    composition: "glass", attributes: { hardness: 70, durability: 78, heatResistance: 86, corrosionResistance: 88, workability: 32 },
  }),
  buildingMaterialRule({
    id: "roof_tile_ash_gray", buildingMaterialId: 100, className: "ceramic", inputs: [["material:roof_tile_terracotta", 4], ["ash", 1], ["basalt", 1], ["material:glass_ingot", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glaze_firing", station: "kiln", processSeconds: 52, yieldCount: 4, yieldBps: 9300, artisanLevel: 3,
    densityKgM3: 2120, thermalConductivityWMK: 1.0, waterAbsorptionPct: 1.8, compressiveStrengthMpa: 65, flexuralStrengthMpa: 22,
    composition: "basalt", attributes: { hardness: 76, durability: 84, heatResistance: 90, corrosionResistance: 92, workability: 30 },
  }),
  buildingMaterialRule({
    id: "roof_tile_mycelium", buildingMaterialId: 101, className: "ceramic", inputs: [["material:roof_tile_terracotta", 4], ["glowMycelium", 1], ["material:salt_flux", 1], ["material:glass_ingot", 1]],
    requiredHeatTier: 3, temperatureC: 1050, processType: "glaze_firing", station: "kiln", processSeconds: 54, yieldCount: 4, yieldBps: 8800, artisanLevel: 4,
    densityKgM3: 2030, thermalConductivityWMK: 0.9, waterAbsorptionPct: 2.2, compressiveStrengthMpa: 56, flexuralStrengthMpa: 18,
    composition: "glass", attributes: { hardness: 68, durability: 76, heatResistance: 78, corrosionResistance: 86, workability: 28 },
  }),
]);

export const BLASTING_CHARGE_RULE = {
  id: "blasting_charge",
  class: "chemical",
  rawInputs: [
    { key: "ash", amount: 1 },
    { key: "toxicWater", amount: 1 },
  ],
  materialInputs: [
    { key: "material:charcoal", amount: 2 },
    { key: "material:biochar_compost", amount: 2 },
    { key: "material:resin_binder", amount: 1 },
  ],
  catalysts: [],
  requiredHeatTier: 0,
  temperatureC: 20,
  artisanLevel: 3,
  yieldCount: 1,
  yieldBps: 9000,
  unitVolumeMm3: 750000,
  forgeUse: "explosive",
  renderMode: "blasting_charge",
  processType: "cold_compaction",
  station: "explosives_bench",
  processSeconds: 36,
  densityKgM3: 1250,
  composition: [
    ["C", "30-45%"],
    ["O", "25-40%"],
    ["N", "2-8%"],
    ["K", "2-10%"],
    ["S", "0.5-4%"],
    ["H", "3-8%"],
  ],
};

// Append new manufactured items so every existing material keeps its stable
// item code and RecipeTable slot.
smeltingRules.materials.push(...BUILDING_MATERIAL_RULES, BLASTING_CHARGE_RULE);

export const BUILDING_MATERIAL_RECIPE_IDS = Object.freeze(BUILDING_MATERIAL_RULES.map((material) => material.id));

export function smeltingMaterialIdForBuildingMaterialId(buildingMaterialId) {
  const numericId = Number(buildingMaterialId);
  return BUILDING_MATERIAL_RULES.find((material) => material.buildingMaterialId === numericId)?.id ?? null;
}

export function buildingMaterialIdForSmeltingMaterialId(materialId) {
  return BUILDING_MATERIAL_RULES.find((material) => material.id === materialId)?.buildingMaterialId ?? 0;
}

function buildingMaterialRule(definition) {
  const className = String(definition.className);
  const baseAttributes = BUILDING_ATTRIBUTE_BASES[className] ?? BUILDING_ATTRIBUTE_BASES.composite;
  const inputs = (definition.inputs ?? []).map(([key, amount]) => ({ key, amount }));
  const unitDimensionsVu = BUILDING_MATERIAL_DIMENSIONS_VU[definition.buildingMaterialId];
  if (!unitDimensionsVu) throw new Error(`Building material ${definition.id} is missing canonical dimensions`);
  const unitVolumeMm3 = Math.round(
    unitDimensionsVu.reduce((volume, dimension) => volume * dimension, BUILDING_VOXEL_VOLUME_MM3),
  );
  const attributes = { ...baseAttributes, ...(definition.attributes ?? {}) };
  return {
    id: definition.id,
    buildingMaterialId: definition.buildingMaterialId,
    class: className,
    rawInputs: inputs.filter((input) => !input.key.startsWith("material:")),
    materialInputs: inputs.filter((input) => input.key.startsWith("material:")),
    catalysts: [],
    requiredHeatTier: definition.requiredHeatTier ?? 0,
    temperatureC: definition.temperatureC ?? 20,
    artisanLevel: definition.artisanLevel ?? 1,
    yieldCount: definition.yieldCount ?? 1,
    yieldBps: definition.yieldBps,
    unitDimensionsVu,
    unitVolumeMm3,
    forgeUse: "construction",
    renderMode: "building_component",
    processType: definition.processType,
    station: definition.station,
    processSeconds: definition.processSeconds,
    densityKgM3: definition.densityKgM3,
    densityScore: attributes.density,
    thermalConductivityWMK: definition.thermalConductivityWMK,
    waterAbsorptionPct: definition.waterAbsorptionPct,
    compressiveStrengthMpa: definition.compressiveStrengthMpa,
    flexuralStrengthMpa: definition.flexuralStrengthMpa,
    composition: BUILDING_COMPOSITIONS[definition.composition] ?? BUILDING_COMPOSITIONS.stone,
    attributes,
  };
}

export const smeltingMaterialAttributeProfiles = {
  charcoal: { hardness: 18, durability: 35, toughness: 22, ductility: 5, brittleness: 42, density: 25, heatResistance: 62, corrosionResistance: 70, conductivity: 22, thermalConductivity: 18, magnetism: 0, workability: 58 },
  biochar_compost: { hardness: 8, durability: 22, toughness: 16, ductility: 10, brittleness: 35, density: 18, heatResistance: 34, corrosionResistance: 62, conductivity: 12, thermalConductivity: 14, magnetism: 0, workability: 72 },
  resin_binder: { hardness: 16, durability: 42, toughness: 36, ductility: 58, brittleness: 22, density: 20, heatResistance: 30, corrosionResistance: 68, conductivity: 5, thermalConductivity: 7, magnetism: 0, workability: 82 },
  ceramic_brick: { hardness: 62, durability: 64, toughness: 36, ductility: 2, brittleness: 74, density: 54, heatResistance: 78, corrosionResistance: 72, conductivity: 8, thermalConductivity: 24, magnetism: 0, workability: 34 },
  lime_ceramic: { hardness: 54, durability: 56, toughness: 32, ductility: 2, brittleness: 68, density: 48, heatResistance: 72, corrosionResistance: 66, conductivity: 7, thermalConductivity: 20, magnetism: 0, workability: 42 },
  quicklime: { hardness: 38, durability: 34, toughness: 20, ductility: 1, brittleness: 82, density: 42, heatResistance: 64, corrosionResistance: 24, conductivity: 8, thermalConductivity: 18, magnetism: 0, workability: 46 },
  salt_flux: { hardness: 24, durability: 26, toughness: 16, ductility: 4, brittleness: 62, density: 36, heatResistance: 42, corrosionResistance: 22, conductivity: 22, thermalConductivity: 26, magnetism: 0, workability: 74 },
  ash_cement: { hardness: 58, durability: 68, toughness: 46, ductility: 4, brittleness: 48, density: 50, heatResistance: 76, corrosionResistance: 62, conductivity: 10, thermalConductivity: 22, magnetism: 2, workability: 54 },
  glass_ingot: { hardness: 58, durability: 44, toughness: 18, ductility: 1, brittleness: 88, density: 45, heatResistance: 52, corrosionResistance: 86, conductivity: 4, thermalConductivity: 16, magnetism: 0, workability: 32 },
  obsidian_glass: { hardness: 72, durability: 56, toughness: 26, ductility: 1, brittleness: 78, density: 55, heatResistance: 68, corrosionResistance: 88, conductivity: 6, thermalConductivity: 18, magnetism: 4, workability: 24 },
  silicon_wafer: { hardness: 66, durability: 38, toughness: 16, ductility: 3, brittleness: 84, density: 42, heatResistance: 64, corrosionResistance: 76, conductivity: 56, thermalConductivity: 70, magnetism: 0, workability: 28 },
  ice_crystal: { hardness: 14, durability: 18, toughness: 10, ductility: 2, brittleness: 76, density: 18, heatResistance: 4, corrosionResistance: 72, conductivity: 3, thermalConductivity: 38, magnetism: 0, workability: 20 },
  iron_bloom: { hardness: 62, durability: 72, toughness: 74, ductility: 52, brittleness: 26, density: 78, heatResistance: 66, corrosionResistance: 34, conductivity: 46, thermalConductivity: 48, magnetism: 70, workability: 62 },
  copper_bloom: { hardness: 42, durability: 58, toughness: 48, ductility: 86, brittleness: 14, density: 82, heatResistance: 48, corrosionResistance: 58, conductivity: 94, thermalConductivity: 88, magnetism: 2, workability: 84 },
  alumina_plate: { hardness: 84, durability: 66, toughness: 38, ductility: 1, brittleness: 72, density: 42, heatResistance: 92, corrosionResistance: 86, conductivity: 6, thermalConductivity: 32, magnetism: 0, workability: 30 },
  nickel_iron: { hardness: 70, durability: 78, toughness: 76, ductility: 50, brittleness: 24, density: 80, heatResistance: 72, corrosionResistance: 48, conductivity: 42, thermalConductivity: 44, magnetism: 92, workability: 56 },
  carbon_plate: { hardness: 78, durability: 62, toughness: 48, ductility: 10, brittleness: 58, density: 30, heatResistance: 86, corrosionResistance: 88, conductivity: 38, thermalConductivity: 58, magnetism: 0, workability: 44 },
  carbon_steel: { hardness: 86, durability: 88, toughness: 82, ductility: 44, brittleness: 30, density: 76, heatResistance: 74, corrosionResistance: 42, conductivity: 36, thermalConductivity: 42, magnetism: 78, workability: 52 },
  basalt_fiber: { hardness: 66, durability: 70, toughness: 62, ductility: 38, brittleness: 34, density: 34, heatResistance: 94, corrosionResistance: 82, conductivity: 8, thermalConductivity: 24, magnetism: 6, workability: 48 },
  basalt_composite: { hardness: 78, durability: 82, toughness: 78, ductility: 22, brittleness: 34, density: 52, heatResistance: 92, corrosionResistance: 80, conductivity: 12, thermalConductivity: 28, magnetism: 8, workability: 42 },
  geopolymer_block: { hardness: 64, durability: 76, toughness: 58, ductility: 4, brittleness: 42, density: 56, heatResistance: 84, corrosionResistance: 78, conductivity: 9, thermalConductivity: 22, magnetism: 4, workability: 46 },
  coral_lime: { hardness: 48, durability: 54, toughness: 32, ductility: 2, brittleness: 66, density: 40, heatResistance: 62, corrosionResistance: 70, conductivity: 7, thermalConductivity: 18, magnetism: 0, workability: 50 },
  toxic_glass: { hardness: 60, durability: 50, toughness: 20, ductility: 1, brittleness: 84, density: 48, heatResistance: 56, corrosionResistance: 94, conductivity: 8, thermalConductivity: 18, magnetism: 0, workability: 22 },
  cotton_cloth: { hardness: 8, durability: 46, toughness: 54, ductility: 78, brittleness: 8, density: 10, heatResistance: 22, corrosionResistance: 44, conductivity: 4, thermalConductivity: 6, magnetism: 0, workability: 92 },
  white_dye: { hardness: 6, durability: 24, toughness: 14, ductility: 20, brittleness: 18, density: 20, heatResistance: 28, corrosionResistance: 72, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 90 },
  yellow_dye: { hardness: 6, durability: 24, toughness: 14, ductility: 20, brittleness: 18, density: 20, heatResistance: 28, corrosionResistance: 72, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 90 },
  red_dye: { hardness: 6, durability: 24, toughness: 14, ductility: 20, brittleness: 18, density: 20, heatResistance: 28, corrosionResistance: 72, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 90 },
  blue_dye: { hardness: 6, durability: 24, toughness: 14, ductility: 20, brittleness: 18, density: 20, heatResistance: 28, corrosionResistance: 72, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 90 },
  pink_dye: { hardness: 6, durability: 24, toughness: 14, ductility: 20, brittleness: 18, density: 20, heatResistance: 28, corrosionResistance: 72, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 90 },
  blasting_charge: { hardness: 18, durability: 42, toughness: 30, ductility: 24, brittleness: 50, density: 38, heatResistance: 6, corrosionResistance: 34, conductivity: 8, thermalConductivity: 12, magnetism: 0, workability: 26 },
};

// These values describe one canonical inventory unit in its rendered bulk form.
export const smeltingMaterialPhysicalProfiles = Object.freeze({
  charcoal: Object.freeze({ unitVolumeMm3: 750000, densityKgM3: 250, thermalConductivityWMK: 0.12, waterAbsorptionPct: 18 }),
  biochar_compost: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 450, thermalConductivityWMK: 0.18, waterAbsorptionPct: 45 }),
  resin_binder: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 1100, thermalConductivityWMK: 0.2, waterAbsorptionPct: 0.5 }),
  ceramic_brick: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 1900, thermalConductivityWMK: 0.9, waterAbsorptionPct: 12, compressiveStrengthMpa: 35, flexuralStrengthMpa: 5 }),
  lime_ceramic: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 1750, thermalConductivityWMK: 0.75, waterAbsorptionPct: 16, compressiveStrengthMpa: 28, flexuralStrengthMpa: 4 }),
  quicklime: Object.freeze({ unitVolumeMm3: 500000, densityKgM3: 900, thermalConductivityWMK: 0.35, waterAbsorptionPct: 100 }),
  salt_flux: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 1200, thermalConductivityWMK: 0.55, waterAbsorptionPct: 25 }),
  ash_cement: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 1300, thermalConductivityWMK: 0.4, waterAbsorptionPct: 22 }),
  glass_ingot: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 2500, thermalConductivityWMK: 1.0, waterAbsorptionPct: 0, compressiveStrengthMpa: 1000, flexuralStrengthMpa: 45 }),
  obsidian_glass: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 2400, thermalConductivityWMK: 1.3, waterAbsorptionPct: 0.1, compressiveStrengthMpa: 900, flexuralStrengthMpa: 40 }),
  silicon_wafer: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 2330, thermalConductivityWMK: 148, waterAbsorptionPct: 0, compressiveStrengthMpa: 7000, flexuralStrengthMpa: 170 }),
  ice_crystal: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 917, thermalConductivityWMK: 2.2, waterAbsorptionPct: 0, compressiveStrengthMpa: 5, flexuralStrengthMpa: 1 }),
  iron_bloom: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 7000, thermalConductivityWMK: 55, waterAbsorptionPct: 2, compressiveStrengthMpa: 180, flexuralStrengthMpa: 120 }),
  copper_bloom: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 8200, thermalConductivityWMK: 360, waterAbsorptionPct: 1, compressiveStrengthMpa: 210, flexuralStrengthMpa: 170 }),
  alumina_plate: Object.freeze({ unitVolumeMm3: 60000, densityKgM3: 3900, thermalConductivityWMK: 30, waterAbsorptionPct: 0, compressiveStrengthMpa: 2200, flexuralStrengthMpa: 350 }),
  nickel_iron: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 8100, thermalConductivityWMK: 28, waterAbsorptionPct: 0, compressiveStrengthMpa: 650, flexuralStrengthMpa: 480 }),
  carbon_plate: Object.freeze({ unitVolumeMm3: 60000, densityKgM3: 1600, thermalConductivityWMK: 8, waterAbsorptionPct: 0.3, compressiveStrengthMpa: 500, flexuralStrengthMpa: 350 }),
  carbon_steel: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 7850, thermalConductivityWMK: 45, waterAbsorptionPct: 0, compressiveStrengthMpa: 600, flexuralStrengthMpa: 500 }),
  basalt_fiber: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 2670, thermalConductivityWMK: 0.04, waterAbsorptionPct: 0.5, flexuralStrengthMpa: 1000 }),
  basalt_composite: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 2100, thermalConductivityWMK: 0.45, waterAbsorptionPct: 0.4, compressiveStrengthMpa: 420, flexuralStrengthMpa: 520 }),
  geopolymer_block: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 2200, thermalConductivityWMK: 1.1, waterAbsorptionPct: 5, compressiveStrengthMpa: 70, flexuralStrengthMpa: 8 }),
  coral_lime: Object.freeze({ unitVolumeMm3: 500000, densityKgM3: 900, thermalConductivityWMK: 0.35, waterAbsorptionPct: 35 }),
  toxic_glass: Object.freeze({ unitVolumeMm3: 250000, densityKgM3: 2550, thermalConductivityWMK: 0.95, waterAbsorptionPct: 0, compressiveStrengthMpa: 950, flexuralStrengthMpa: 42 }),
  cotton_cloth: Object.freeze({ unitVolumeMm3: 1000000, densityKgM3: 150, thermalConductivityWMK: 0.04, waterAbsorptionPct: 27, flexuralStrengthMpa: 0.04 }),
  white_dye: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 1200, thermalConductivityWMK: 0.25, waterAbsorptionPct: 8 }),
  yellow_dye: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 1100, thermalConductivityWMK: 0.22, waterAbsorptionPct: 10 }),
  red_dye: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 1150, thermalConductivityWMK: 0.23, waterAbsorptionPct: 9 }),
  blue_dye: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 1250, thermalConductivityWMK: 0.27, waterAbsorptionPct: 8 }),
  pink_dye: Object.freeze({ unitVolumeMm3: 20000, densityKgM3: 1120, thermalConductivityWMK: 0.22, waterAbsorptionPct: 10 }),
  blasting_charge: Object.freeze({ unitVolumeMm3: 750000, densityKgM3: 1250, thermalConductivityWMK: 0.18, waterAbsorptionPct: 2 }),
});

for (const material of BUILDING_MATERIAL_RULES) {
  smeltingMaterialAttributeProfiles[material.id] = material.attributes;
}

const smeltingClassFallbackAttributes = {
  wood: { hardness: 32, durability: 64, toughness: 70, ductility: 34, brittleness: 24, density: 46, heatResistance: 34, corrosionResistance: 44, conductivity: 3, thermalConductivity: 7, magnetism: 0, workability: 90 },
  stone: { hardness: 72, durability: 78, toughness: 52, ductility: 1, brittleness: 58, density: 65, heatResistance: 84, corrosionResistance: 80, conductivity: 7, thermalConductivity: 30, magnetism: 2, workability: 34 },
  carbon: { hardness: 38, durability: 46, toughness: 34, ductility: 8, brittleness: 48, density: 28, heatResistance: 68, corrosionResistance: 76, conductivity: 28, thermalConductivity: 32, magnetism: 0, workability: 52 },
  fiber: { hardness: 24, durability: 48, toughness: 58, ductility: 62, brittleness: 18, density: 18, heatResistance: 36, corrosionResistance: 54, conductivity: 6, thermalConductivity: 10, magnetism: 0, workability: 74 },
  polymer: { hardness: 26, durability: 48, toughness: 46, ductility: 58, brittleness: 24, density: 24, heatResistance: 34, corrosionResistance: 68, conductivity: 5, thermalConductivity: 8, magnetism: 0, workability: 78 },
  ceramic: { hardness: 62, durability: 58, toughness: 34, ductility: 2, brittleness: 72, density: 46, heatResistance: 76, corrosionResistance: 72, conductivity: 7, thermalConductivity: 22, magnetism: 0, workability: 36 },
  chemical: { hardness: 28, durability: 28, toughness: 18, ductility: 4, brittleness: 64, density: 38, heatResistance: 44, corrosionResistance: 28, conductivity: 20, thermalConductivity: 22, magnetism: 0, workability: 66 },
  glass: { hardness: 62, durability: 46, toughness: 20, ductility: 1, brittleness: 84, density: 48, heatResistance: 58, corrosionResistance: 86, conductivity: 5, thermalConductivity: 18, magnetism: 0, workability: 28 },
  crystal: { hardness: 56, durability: 34, toughness: 16, ductility: 2, brittleness: 80, density: 32, heatResistance: 42, corrosionResistance: 74, conductivity: 24, thermalConductivity: 48, magnetism: 0, workability: 24 },
  metal: { hardness: 58, durability: 70, toughness: 68, ductility: 62, brittleness: 22, density: 78, heatResistance: 62, corrosionResistance: 44, conductivity: 68, thermalConductivity: 66, magnetism: 36, workability: 66 },
  alloy: { hardness: 78, durability: 82, toughness: 78, ductility: 46, brittleness: 28, density: 74, heatResistance: 76, corrosionResistance: 52, conductivity: 38, thermalConductivity: 44, magnetism: 62, workability: 52 },
  composite: { hardness: 66, durability: 76, toughness: 68, ductility: 16, brittleness: 38, density: 50, heatResistance: 82, corrosionResistance: 78, conductivity: 12, thermalConductivity: 26, magnetism: 4, workability: 46 },
};

export default smeltingRules;

export const SMELTING_RECIPES_PER_TABLE = 10;
export const SMELTING_RECIPE_TABLE_ID_BASE = 220;
export const SMELTING_MERGE_RECIPE_TABLE_ID_BASE = 320;
export const SMELTING_MATERIAL_ITEM_CODE_BASE = 1001;
export const SMELTING_MERGE_RECIPE_ID_OFFSET = 1000;
export const SMELTING_RESERVED_MATERIAL_ITEM_CODES = Object.freeze([1003]);
export const SMELTING_MATERIAL_INPUT_PREFIX = "material:";
export const SMELTING_RECIPE_YIELD_BPS_DENOMINATOR = 10_000;
export const SMELTING_DEFAULT_INPUT_VOLUME_MM3 = 1_000_000;

for (const material of smeltingRules.materials) {
  const physical = smeltingMaterialPhysicalProfiles[material.id];
  if (physical) Object.assign(material, physical);
  material.itemCode = smeltingMaterialItemCode(material.id);
  material.recipeId = smeltingRecipeIdForMaterialId(material.id);
  material.mergeRecipeId = smeltingMergeRecipeIdForMaterialId(material.id);
  material.recipeTableId = smeltingRecipeTableIdForMaterialId(material.id);
  material.mergeRecipeTableId = smeltingMergeRecipeTableIdForMaterialId(material.id);
  material.attributes = smeltingMaterialBaseAttributes(material);
  material.yieldBps = smeltingRecipeYieldBps(material);
  material.mergeYieldBps = SMELTING_RECIPE_YIELD_BPS_DENOMINATOR;
}

export function smeltingMaterialPhysicalProfile(materialOrId, rules = smeltingRules) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId, rules) : materialOrId;
  if (!material) return null;
  const unitVolumeMm3 = Math.max(0, Math.trunc(Number(material.unitVolumeMm3) || 0));
  const densityKgM3 = Math.max(0, Number(material.densityKgM3) || 0);
  const volumeM3 = unitVolumeMm3 / 1_000_000_000;
  return Object.freeze({
    unitDimensionsVu: Array.isArray(material.unitDimensionsVu) ? Object.freeze([...material.unitDimensionsVu]) : null,
    unitVolumeMm3,
    volumeM3,
    densityKgM3,
    massKg: densityKgM3 * volumeM3,
    thermalConductivityWMK: finitePhysicalValue(material.thermalConductivityWMK),
    waterAbsorptionPct: finitePhysicalValue(material.waterAbsorptionPct),
    compressiveStrengthMpa: finitePhysicalValue(material.compressiveStrengthMpa),
    flexuralStrengthMpa: finitePhysicalValue(material.flexuralStrengthMpa),
  });
}

function finitePhysicalValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}


export function smeltingMaterialBaseAttributes(materialOrId, rules = smeltingRules) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId, rules) : materialOrId;
  const fallback = smeltingClassFallbackAttributes[material?.class] ?? smeltingClassFallbackAttributes.composite;
  const profile = smeltingMaterialAttributeProfiles[material?.id] ?? fallback;
  return normalizeSmeltingAttributes({ ...fallback, ...profile });
}

export function normalizeSmeltingAttributes(attributes = {}) {
  const normalized = {};
  for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) {
    normalized[key] = clampSmeltingScore(attributes[key] ?? 0);
  }
  return normalized;
}

export function deriveSmeltingMaterialProperties({
  material,
  inputSlots = [],
  fuelSlots = [],
  itemId = 0,
  itemCode = 0,
  sourceSeed = 0,
} = {}) {
  const base = smeltingMaterialBaseAttributes(material);
  const source = deriveSmeltingSourceAttributes(inputSlots, material);
  const quality = deriveSmeltingQuality({ material, inputSlots, fuelSlots, itemId, itemCode, sourceSeed });
  const attributes = {};
  for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) {
    const baseValue = base[key] ?? 0;
    const sourceValue = source[key] ?? baseValue;
    const qualityDelta = (quality.score - 70) * smeltingQualityWeightForAttribute(key);
    attributes[key] = clampSmeltingScore(Math.round(baseValue * 0.7 + sourceValue * 0.2 + quality.score * 0.1 + qualityDelta));
  }
  return {
    attributes,
    purity: quality.purity,
    grade: quality.grade,
    qualityScore: quality.score,
  };
}

export function deriveSmeltingQuality({ material, inputSlots = [], fuelSlots = [], itemId = 0, itemCode = 0, sourceSeed = 0 } = {}) {
  const requiredHeat = Math.max(0, Number(material?.requiredHeatTier) || 0);
  const maxFuel = Math.max(0, ...fuelSlots.map((slot) => Number(slot?.fuelTier ?? slot?.heatTier ?? 0)).filter(Number.isFinite));
  const heatFit = maxFuel > 0 ? clampNumber(maxFuel - requiredHeat, -2, 2) : 0;
  const sourceCount = Math.max(1, inputSlots.length || recipeInputCount(material));
  const artisan = Math.max(1, Number(material?.artisanLevel) || 1);
  const seed = numericSmeltingSeed([material?.id ?? "", itemId, itemCode, sourceSeed, sourceCount].join("|"));
  const variance = (seed % 11) - 5;
  const score = clampSmeltingScore(Math.round(62 + artisan * 4 + sourceCount * 1.4 + heatFit * 5 + variance));
  return {
    score,
    purity: clampSmeltingScore(Math.round(score + 8 + Math.max(0, heatFit) * 2 - Math.max(0, sourceCount - 4))),
    grade: smeltingGradeForScore(score),
  };
}

export function deriveSmeltingSourceAttributes(inputSlots = [], material = null) {
  if (!inputSlots.length) return smeltingMaterialBaseAttributes(material);
  const totals = Object.fromEntries(SMELTING_MATERIAL_ATTRIBUTE_KEYS.map((key) => [key, 0]));
  let weightTotal = 0;
  for (const slot of inputSlots) {
    const profile = smeltingSourceAttributeProfile(slot);
    const weight = Math.max(0.5, Number(slot?.massKg) || 1);
    for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) totals[key] += profile[key] * weight;
    weightTotal += weight;
  }
  const result = {};
  for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) result[key] = clampSmeltingScore(Math.round(totals[key] / Math.max(1, weightTotal)));
  return result;
}

export function smeltingSourceAttributeProfile(slot = {}) {
  if (slot?.materialProperties?.attributes) return normalizeSmeltingAttributes(slot.materialProperties.attributes);
  const category = slot?.category ?? slot?.atlas?.category ?? "";
  const densityKgM3 = Number(slot?.densityKgM3 ?? slot?.atlas?.physical?.densityKgM3 ?? 0);
  const density = densityKgM3 > 0 ? clampSmeltingScore(Math.round(densityKgM3 / 100)) : 35;
  const composition = slot?.composition ?? slot?.atlas?.composition ?? [];
  const elementScore = (symbol) => compositionMidpointForElement(composition, symbol);
  const fe = elementScore("Fe");
  const c = elementScore("C");
  const si = elementScore("Si");
  const ca = elementScore("Ca");
  const al = elementScore("Al");
  const organic = ["organic", "plants", "aquatic"].includes(category);
  const fluid = category === "fluids";
  return normalizeSmeltingAttributes({
    hardness: organic ? 18 + c * 0.2 : 26 + si * 0.55 + fe * 0.8 + al * 0.45,
    durability: organic ? 30 + c * 0.35 : 35 + density * 0.32 + fe * 0.7 + si * 0.25,
    toughness: organic ? 42 + c * 0.25 : 30 + density * 0.22 + fe * 0.65,
    ductility: organic ? 58 : 18 + fe * 0.25 + ca * 0.15,
    brittleness: fluid ? 8 : organic ? 22 : 36 + si * 0.4 + ca * 0.25,
    density,
    heatResistance: organic ? 24 + c * 0.5 : 38 + si * 0.35 + al * 0.55 + fe * 0.25,
    corrosionResistance: organic ? 42 : 44 + si * 0.25 + ca * 0.2,
    conductivity: 4 + fe * 0.7 + c * 0.25,
    thermalConductivity: 8 + density * 0.18 + fe * 0.35 + c * 0.18,
    magnetism: fe * 2.4,
    workability: organic ? 72 : fluid ? 20 : 46 + ca * 0.15 - si * 0.1,
  });
}

export function smeltingTopAttributeEntries(attributes = {}, count = 4) {
  return SMELTING_MATERIAL_ATTRIBUTE_KEYS
    .map((key) => [key, clampSmeltingScore(attributes[key] ?? 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);
}

export function smeltingGradeForScore(score) {
  if (score >= 92) return "mythic";
  if (score >= 82) return "prime";
  if (score >= 70) return "refined";
  if (score >= 56) return "standard";
  return "crude";
}

function recipeInputCount(material) {
  return recipeRequirements(material)
    .reduce((sum, input) => sum + (Number(input?.amount) || 0), 0);
}

function smeltingQualityWeightForAttribute(key) {
  if (["hardness", "durability", "toughness", "heatResistance", "corrosionResistance"].includes(key)) return 0.18;
  if (["conductivity", "thermalConductivity", "magnetism"].includes(key)) return 0.12;
  if (key === "brittleness") return -0.08;
  return 0.08;
}

function compositionMidpointForElement(composition = [], symbol) {
  const entry = composition.find(([candidate]) => candidate === symbol);
  if (!entry) return 0;
  return smeltingCompositionMidpoint(entry[1]);
}

function smeltingCompositionMidpoint(range) {
  const numbers = String(range).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!numbers.length) return 0;
  if (numbers.length === 1) return numbers[0];
  return (numbers[0] + numbers[1]) / 2;
}

function numericSmeltingSeed(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampSmeltingScore(value) {
  return clampNumber(Math.round(Number(value) || 0), 0, 100);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function validateSmeltingRules(rules = smeltingRules) {
  if (!rules || typeof rules !== "object") throw new Error("Missing smelting rules");
  if (!Number.isInteger(rules.schemaVersion)) throw new Error("Missing smelting schemaVersion");
  if (!rules.ruleSet) throw new Error("Missing smelting ruleSet");
  const heatTiers = Array.isArray(rules.heatTiers) ? rules.heatTiers : [];
  const fuels = Array.isArray(rules.fuels) ? rules.fuels : [];
  const materials = Array.isArray(rules.materials) ? rules.materials : [];
  if (!heatTiers.length) throw new Error("Smelting rules require heatTiers");
  if (!fuels.length) throw new Error("Smelting rules require fuels");
  if (!materials.length) throw new Error("Smelting rules require materials");

  const heatTierIds = new Set();
  for (const tier of heatTiers) {
    if (!Number.isInteger(tier.tier) || tier.tier < 0) throw new Error(`Invalid heat tier: ${JSON.stringify(tier)}`);
    if (heatTierIds.has(tier.tier)) throw new Error(`Duplicate heat tier: ${tier.tier}`);
    heatTierIds.add(tier.tier);
  }

  const fuelIds = new Set();
  for (const fuel of fuels) {
    if (!fuel.id) throw new Error("Fuel missing id");
    if (fuelIds.has(fuel.id)) throw new Error(`Duplicate fuel id: ${fuel.id}`);
    fuelIds.add(fuel.id);
    if (!heatTierIds.has(fuel.heatTier)) throw new Error(`Fuel ${fuel.id} uses unknown heat tier ${fuel.heatTier}`);
    if (fuel.sourceType === "raw" && !Array.isArray(fuel.sourceKeys)) throw new Error(`Raw fuel ${fuel.id} requires sourceKeys`);
    if (fuel.sourceType === "material" && !fuel.materialId) throw new Error(`Material fuel ${fuel.id} requires materialId`);
  }

  const materialIds = new Set();
  for (const material of materials) {
    if (!material.id) throw new Error("Material missing id");
    if (materialIds.has(material.id)) throw new Error(`Duplicate material id: ${material.id}`);
    materialIds.add(material.id);
    if (!material.class) throw new Error(`Material ${material.id} missing class`);
    if (!Array.isArray(material.rawInputs)) throw new Error(`Material ${material.id} requires rawInputs`);
    if (!recipeRequirements(material).length) throw new Error(`Material ${material.id} requires inputs`);
    if (!heatTierIds.has(material.requiredHeatTier)) throw new Error(`Material ${material.id} uses unknown heat tier ${material.requiredHeatTier}`);
    if (!Number.isInteger(material.yieldCount) || material.yieldCount < 1) throw new Error(`Material ${material.id} has invalid yieldCount`);
    if (!Number.isInteger(material.yieldBps) || material.yieldBps < 1 || material.yieldBps > SMELTING_RECIPE_YIELD_BPS_DENOMINATOR) {
      throw new Error(`Material ${material.id} has invalid yieldBps`);
    }
    if (!Number.isInteger(material.unitVolumeMm3)
      || material.unitVolumeMm3 < 1
      || material.unitVolumeMm3 > 0xffffffff
    ) {
      throw new Error(`Material ${material.id} has invalid unitVolumeMm3`);
    }
    if (!Number.isFinite(material.densityKgM3) || material.densityKgM3 <= 0) {
      throw new Error(`Material ${material.id} has invalid densityKgM3`);
    }
    for (const key of ["thermalConductivityWMK", "waterAbsorptionPct"]) {
      if (!Number.isFinite(material[key]) || material[key] < 0) {
        throw new Error(`Material ${material.id} has invalid ${key}`);
      }
    }
    if (material.buildingMaterialId !== undefined) {
      if (!Array.isArray(material.unitDimensionsVu) || material.unitDimensionsVu.length !== 3
        || material.unitDimensionsVu.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)) {
        throw new Error(`Building material ${material.id} has invalid unitDimensionsVu`);
      }
      const expectedVolumeMm3 = Math.round(
        material.unitDimensionsVu.reduce((volume, dimension) => volume * dimension, BUILDING_VOXEL_VOLUME_MM3),
      );
      if (material.unitVolumeMm3 !== expectedVolumeMm3) {
        throw new Error(`Building material ${material.id} volume does not match its canonical dimensions`);
      }
    }
    if (material.forgeUse === "dye" && !/^#[0-9a-f]{6}$/iu.test(String(material.dyeColor ?? ""))) {
      throw new Error(`Dye material ${material.id} has invalid dyeColor`);
    }
    const attributes = smeltingMaterialBaseAttributes(material);
    for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) {
      if (!Number.isInteger(attributes[key]) || attributes[key] < 0 || attributes[key] > 100) {
        throw new Error(`Material ${material.id} has invalid attribute ${key}`);
      }
    }
    for (const input of recipeRequirements(material)) {
      if (!input.key || !Number.isFinite(input.amount) || input.amount < 1) {
        throw new Error(`Material ${material.id} has invalid input ${JSON.stringify(input)}`);
      }
    }
  }

  for (const material of materials) {
    for (const input of recipeRequirements(material)) {
      const referencedMaterialId = smeltingMaterialIdForInputKey(input.key);
      if (referencedMaterialId !== null && !materialIds.has(referencedMaterialId)) {
        throw new Error(`Material ${material.id} references unknown material ${referencedMaterialId}`);
      }
    }
  }

  for (const fuel of fuels) {
    if (fuel.sourceType === "material" && !materialIds.has(fuel.materialId)) {
      throw new Error(`Fuel ${fuel.id} points to unknown material ${fuel.materialId}`);
    }
  }
  return true;
}

export function smeltingHeatTierByTier(tier, rules = smeltingRules) {
  return (rules.heatTiers ?? []).find((item) => item.tier === tier) ?? null;
}

export function smeltingMaterialById(id, rules = smeltingRules) {
  return (rules.materials ?? []).find((material) => material.id === id) ?? null;
}

export function smeltingRecipeIdForMaterialId(id, rules = smeltingRules) {
  return smeltingMaterialItemCode(id, rules);
}

export function smeltingMergeRecipeIdForMaterialId(id, rules = smeltingRules) {
  const itemCode = smeltingMaterialItemCode(id, rules);
  return itemCode ? itemCode + SMELTING_MERGE_RECIPE_ID_OFFSET : 0;
}

export function smeltingRecipeTableIdForMaterialId(id, rules = smeltingRules) {
  const recipeId = smeltingRecipeIdForMaterialId(id, rules);
  return recipeId
    ? Math.floor((recipeId - SMELTING_MATERIAL_ITEM_CODE_BASE) / SMELTING_RECIPES_PER_TABLE) + SMELTING_RECIPE_TABLE_ID_BASE
    : 0;
}

export function smeltingMergeRecipeTableIdForMaterialId(id, rules = smeltingRules) {
  const recipeId = smeltingRecipeIdForMaterialId(id, rules);
  return recipeId
    ? Math.floor((recipeId - SMELTING_MATERIAL_ITEM_CODE_BASE) / SMELTING_RECIPES_PER_TABLE) + SMELTING_MERGE_RECIPE_TABLE_ID_BASE
    : 0;
}

export function smeltingRecipeTableIdForRecipeId(recipeId, rules = smeltingRules) {
  const numericRecipeId = Number(recipeId);
  if (!Number.isInteger(numericRecipeId)) return 0;
  const merge = numericRecipeId >= SMELTING_MATERIAL_ITEM_CODE_BASE + SMELTING_MERGE_RECIPE_ID_OFFSET;
  const itemCode = merge ? numericRecipeId - SMELTING_MERGE_RECIPE_ID_OFFSET : numericRecipeId;
  if (!smeltingMaterialIdForItemCode(itemCode, rules)) return 0;
  return Math.floor((itemCode - SMELTING_MATERIAL_ITEM_CODE_BASE) / SMELTING_RECIPES_PER_TABLE)
    + (merge ? SMELTING_MERGE_RECIPE_TABLE_ID_BASE : SMELTING_RECIPE_TABLE_ID_BASE);
}

export function smeltingMaterialIdForRecipeId(recipeId, rules = smeltingRules) {
  const numericRecipeId = Number(recipeId);
  if (!Number.isInteger(numericRecipeId)) return null;
  const itemCode = numericRecipeId >= SMELTING_MATERIAL_ITEM_CODE_BASE + SMELTING_MERGE_RECIPE_ID_OFFSET
    ? numericRecipeId - SMELTING_MERGE_RECIPE_ID_OFFSET
    : numericRecipeId;
  return smeltingMaterialIdForItemCode(itemCode, rules);
}

export function smeltingMaterialItemCode(id, rules = smeltingRules) {
  const index = (rules.materials ?? []).findIndex((material) => material.id === id);
  return index >= 0 ? smeltingMaterialItemCodeForIndex(index) : 0;
}

export function smeltingMaterialIdForItemCode(itemCode, rules = smeltingRules) {
  const numericItemCode = Number(itemCode);
  if (!Number.isInteger(numericItemCode) || SMELTING_RESERVED_MATERIAL_ITEM_CODES.includes(numericItemCode)) return null;
  let index = numericItemCode - SMELTING_MATERIAL_ITEM_CODE_BASE;
  for (const reservedItemCode of SMELTING_RESERVED_MATERIAL_ITEM_CODES) {
    if (reservedItemCode < numericItemCode) index -= 1;
  }
  if (index < 0 || smeltingMaterialItemCodeForIndex(index) !== numericItemCode) return null;
  return rules.materials?.[index]?.id ?? null;
}

function smeltingMaterialItemCodeForIndex(index) {
  if (!Number.isInteger(index) || index < 0) return 0;
  let itemCode = SMELTING_MATERIAL_ITEM_CODE_BASE + index;
  for (const reservedItemCode of SMELTING_RESERVED_MATERIAL_ITEM_CODES) {
    if (itemCode >= reservedItemCode) itemCode += 1;
  }
  return itemCode;
}

export function smeltingMaterialInputKey(materialId) {
  return `${SMELTING_MATERIAL_INPUT_PREFIX}${materialId}`;
}

export function smeltingMaterialIdForInputKey(key) {
  const text = String(key ?? "");
  return text.startsWith(SMELTING_MATERIAL_INPUT_PREFIX)
    ? text.slice(SMELTING_MATERIAL_INPUT_PREFIX.length)
    : null;
}

export function createSmeltingMergeRecipe(materialOrId, rules = smeltingRules) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId, rules) : materialOrId;
  if (!material?.id) return null;
  return {
    ...material,
    recipeKind: "merge",
    requiredHeatTier: 0,
    materialInputs: [{ key: smeltingMaterialInputKey(material.id), amount: 1 }],
    rawInputs: [],
    catalysts: [],
    yieldBps: material.mergeYieldBps ?? SMELTING_RECIPE_YIELD_BPS_DENOMINATOR,
    yieldCount: 1,
  };
}

export function smeltingRecipeYieldBps(recipe) {
  const explicit = Number(recipe?.yieldBps);
  if (Number.isInteger(explicit) && explicit > 0) {
    return Math.min(SMELTING_RECIPE_YIELD_BPS_DENOMINATOR, explicit);
  }
  return ({
    carbon: 5500,
    fiber: 6500,
    polymer: 6000,
    ceramic: 7200,
    glass: 8000,
    flux: 7000,
    stone: 8500,
    metal: 6200,
    composite: 5800,
  }[recipe?.class] ?? 6000);
}

export function smeltingSkillOutputBpsForLevel(level) {
  return Math.min(SMELTING_RECIPE_YIELD_BPS_DENOMINATOR, 7000 + Math.max(0, Math.min(10, Math.floor(Number(level) || 0))) * 300);
}

export function smeltingRecipeRequiresFuel(recipe) {
  return Math.max(0, Math.floor(Number(recipe?.requiredHeatTier) || 0)) > 0;
}

export function smeltingMaterialUnitVolumeMm3(materialOrId, rules = smeltingRules) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId, rules) : materialOrId;
  return clampSmeltingVolumeMm3(material?.unitVolumeMm3 ?? SMELTING_DEFAULT_INPUT_VOLUME_MM3);
}

export function smeltingInputUnitVolumeMm3(inputKey, rules = smeltingRules) {
  const materialId = smeltingMaterialIdForInputKey(inputKey);
  return materialId
    ? smeltingMaterialUnitVolumeMm3(materialId, rules)
    : SMELTING_DEFAULT_INPUT_VOLUME_MM3;
}

export function smeltingRecipeInputVolumeMm3(recipe, rules = smeltingRules) {
  return clampSmeltingVolumeMm3(recipeRequirements(recipe).reduce((total, requirement) => {
    const amount = Math.max(1, Math.floor(Number(requirement?.amount) || 1));
    return total + amount * smeltingInputUnitVolumeMm3(requirement?.key, rules);
  }, 0));
}

export function smeltingRecipePdaOutputVolumeMm3(recipe, rules = smeltingRules) {
  if (recipe?.recipeKind === "merge" || recipe?.unitVolumeMm3 !== undefined) {
    return smeltingMaterialUnitVolumeMm3(recipe, rules);
  }
  return smeltingRecipeInputVolumeMm3(recipe, rules);
}

export function calculateSmeltingOutputVolumeMm3({
  recipe,
  inputVolumeMm3,
  servings = 1,
  skillOutputBps,
  pdaOutputVolumeMm3,
  recipeInputVolumeMm3,
  rules = smeltingRules,
} = {}) {
  if (!recipe) return 0;
  const batchCount = BigInt(Math.max(1, Math.floor(Number(servings) || 1)));
  const expectedPerBatch = BigInt(clampSmeltingVolumeMm3(
    recipeInputVolumeMm3 ?? smeltingRecipeInputVolumeMm3(recipe, rules),
  ));
  const expectedBatch = expectedPerBatch * batchCount;
  const actualInput = BigInt(clampSmeltingSafeVolume(inputVolumeMm3 ?? Number(expectedBatch)));
  const outputPerBatch = BigInt(clampSmeltingVolumeMm3(
    pdaOutputVolumeMm3 ?? smeltingRecipePdaOutputVolumeMm3(recipe, rules),
  ));
  const recipeYield = BigInt(smeltingRecipeYieldBps(recipe));
  const skillYield = BigInt(Math.max(1, Math.min(
    SMELTING_RECIPE_YIELD_BPS_DENOMINATOR,
    Math.floor(Number(skillOutputBps) || smeltingSkillOutputBpsForLevel(0)),
  )));
  const denominator = BigInt(SMELTING_RECIPE_YIELD_BPS_DENOMINATOR);
  const scaledOutput = outputPerBatch * batchCount * actualInput / expectedBatch;
  const recipeOutput = scaledOutput * recipeYield / denominator;
  const finalOutput = recipeOutput * skillYield / denominator;
  return Number(finalOutput > 0xffffffffn ? 0xffffffffn : finalOutput > 0n ? finalOutput : 1n);
}

function clampSmeltingVolumeMm3(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 1) return 1;
  return Math.min(0xffffffff, numeric);
}

function clampSmeltingSafeVolume(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 1) return 1;
  return Math.min(Number.MAX_SAFE_INTEGER, numeric);
}

export function smeltingFuelForRawKey(key, rules = smeltingRules) {
  return (rules.fuels ?? [])
    .filter((fuel) => fuel.sourceType === "raw" && (fuel.sourceKeys ?? []).includes(key))
    .sort((a, b) => (b.heatTier ?? 0) - (a.heatTier ?? 0))[0] ?? null;
}

export function smeltingFuelForMaterialId(materialId, rules = smeltingRules) {
  return (rules.fuels ?? [])
    .filter((fuel) => fuel.sourceType === "material" && fuel.materialId === materialId)
    .sort((a, b) => (b.heatTier ?? 0) - (a.heatTier ?? 0))[0] ?? null;
}

export function createSmeltingInputCounts(keys = []) {
  const counts = new Map();
  for (const key of keys.filter(Boolean)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export function recipeRequirements(recipe) {
  return [...(recipe?.rawInputs ?? []), ...(recipe?.materialInputs ?? []), ...(recipe?.catalysts ?? [])];
}

export function hasRequiredSmeltingInputs(recipe, counts) {
  return recipeRequirements(recipe).every((input) => (counts.get(input.key) ?? 0) >= input.amount);
}

export function smeltingRecipeInputMultiplier(recipe, counts) {
  const requirements = recipeRequirements(recipe);
  if (!requirements.length || !counts?.size) return 0;
  const requiredKeys = new Set(requirements.map((input) => input.key));
  for (const key of counts.keys()) {
    if (!requiredKeys.has(key)) return 0;
  }
  let multiplier = null;
  for (const input of requirements) {
    const required = Math.max(1, Number(input.amount) || 1);
    const actual = counts.get(input.key) ?? 0;
    if (actual < required || actual % required !== 0) return 0;
    const nextMultiplier = actual / required;
    if (multiplier === null) multiplier = nextMultiplier;
    if (multiplier !== nextMultiplier) return 0;
  }
  return multiplier ?? 0;
}

export function hasExactSmeltingInputRatio(recipe, counts) {
  return smeltingRecipeInputMultiplier(recipe, counts) >= 1;
}

export function smeltingRecipeMatchScore(recipe, counts) {
  const requirements = recipeRequirements(recipe);
  const requiredTotal = requirements.reduce((sum, input) => sum + input.amount, 0);
  const multiplier = smeltingRecipeInputMultiplier(recipe, counts);
  const matchedTotal = requirements.reduce((sum, input) => sum + Math.min(counts.get(input.key) ?? 0, input.amount * Math.max(1, multiplier)), 0);
  const exact = multiplier >= 1;
  const waste = [...counts.entries()].reduce((sum, [key, count]) => {
    const required = requirements.find((input) => input.key === key)?.amount * Math.max(1, multiplier) || 0;
    return sum + Math.max(0, count - required);
  }, 0);
  return {
    exact,
    multiplier,
    matchedTotal,
    requiredTotal: requiredTotal * Math.max(1, multiplier),
    ratio: requiredTotal > 0 ? matchedTotal / (requiredTotal * Math.max(1, multiplier)) : 0,
    waste,
  };
}

export function findBestSmeltingRecipeForKeys(keys = [], rules = smeltingRules) {
  const counts = createSmeltingInputCounts(keys);
  const materialMergeRecipe = createMergeCandidateFromCounts(counts, rules);
  const candidates = [
    ...(rules.materials ?? []),
    ...(materialMergeRecipe ? [materialMergeRecipe] : []),
  ]
    .map((recipe) => ({ recipe, score: smeltingRecipeMatchScore(recipe, counts) }))
    .filter(({ score }) => score.matchedTotal > 0)
    .sort((a, b) => {
      if (a.score.exact !== b.score.exact) return a.score.exact ? -1 : 1;
      if (b.score.ratio !== a.score.ratio) return b.score.ratio - a.score.ratio;
      if (a.score.waste !== b.score.waste) return a.score.waste - b.score.waste;
      return (a.recipe.requiredHeatTier ?? 0) - (b.recipe.requiredHeatTier ?? 0);
    });
  return candidates[0] ?? null;
}

function createMergeCandidateFromCounts(counts, rules) {
  if (!counts?.size || counts.size !== 1) return null;
  const [[key, count]] = counts.entries();
  if (count < 2) return null;
  const materialId = smeltingMaterialIdForInputKey(key);
  if (!materialId) return null;
  return createSmeltingMergeRecipe(materialId, rules);
}

export function missingSmeltingInputs(recipe, keys = []) {
  const counts = createSmeltingInputCounts(keys);
  return recipeRequirements(recipe)
    .map((input) => ({ ...input, missing: Math.max(0, input.amount - (counts.get(input.key) ?? 0)) }))
    .filter((input) => input.missing > 0);
}

validateSmeltingRules(smeltingRules);
