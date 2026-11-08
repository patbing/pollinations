/* Glassbox.gallery: four complete, hand-checked lessons. Open from file:// with no network. */
(function (G) {
  'use strict';
  G.gallery = [
{
 "format": "glassbox-lesson/1",
 "id": "pendulum",
 "subject": "physics",
 "level": "highschool",
 "language": "en",
 "title": "What sets the rhythm of a pendulum?",
 "topic": "simple pendulum",
 "summary": "Change a pendulum's length, gravity, release angle and mass, and find out which of them really change how long one swing takes.",
 "bigIdea": "A pendulum's period depends on its length and on gravity, not on its mass, and only slightly on how far it swings.",
 "sources": [
  {
   "id": "S1",
   "title": "Pendulum (mechanics)",
   "url": "https://en.wikipedia.org/wiki/Pendulum_(mechanics)",
   "publisher": "Wikipedia",
   "supports": "Small-angle period formula, independence from mass, large-amplitude correction series.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S2",
   "title": "Pendulum clock",
   "url": "https://en.wikipedia.org/wiki/Pendulum_clock",
   "publisher": "Wikipedia",
   "supports": "Pendulum clocks keep time because the period is nearly constant; an escapement replaces energy lost to friction.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S3",
   "title": "Moon",
   "url": "https://en.wikipedia.org/wiki/Moon",
   "publisher": "Wikipedia",
   "supports": "Lunar surface gravity is about 1.62 m/s².",
   "retrieved": "2026-11-08"
  }
 ],
 "sim": {
  "kind": "ode",
  "params": [
   {
    "id": "L",
    "label": "String length",
    "unit": "m",
    "min": 0.2,
    "max": 3,
    "step": 0.05,
    "value": 1,
    "description": "Distance from pivot to the centre of the bob."
   },
   {
    "id": "g",
    "label": "Gravity",
    "unit": "m/s²",
    "min": 1,
    "max": 25,
    "step": 0.01,
    "value": 9.81,
    "description": "Gravitational acceleration.",
    "presets": [
     {
      "label": "Moon",
      "value": 1.62
     },
     {
      "label": "Mars",
      "value": 3.71
     },
     {
      "label": "Earth",
      "value": 9.81
     },
     {
      "label": "Jupiter",
      "value": 24.79
     }
    ]
   },
   {
    "id": "theta0",
    "label": "Release angle",
    "unit": "°",
    "min": 5,
    "max": 80,
    "step": 1,
    "value": 20
   },
   {
    "id": "m",
    "label": "Bob mass",
    "unit": "kg",
    "min": 0.1,
    "max": 5,
    "step": 0.1,
    "value": 1
   },
   {
    "id": "b",
    "label": "Air friction",
    "unit": "1/s",
    "min": 0,
    "max": 0.5,
    "step": 0.01,
    "value": 0
   }
  ],
  "state": [
   {
    "id": "theta",
    "label": "Angle",
    "unit": "rad",
    "initial": "rad(theta0)",
    "rate": "omega"
   },
   {
    "id": "omega",
    "label": "Angular speed",
    "unit": "rad/s",
    "initial": "0",
    "rate": "-(g/L)*sin(theta) - b*omega"
   }
  ],
  "derived": [
   {
    "id": "T0",
    "label": "Period (small-angle formula)",
    "unit": "s",
    "expr": "2*pi*sqrt(L/g)",
    "digits": 2
   },
   {
    "id": "Tbig",
    "label": "Period at this angle",
    "unit": "s",
    "expr": "T0*(1 + rad(theta0)^2/16 + 11*rad(theta0)^4/3072)",
    "digits": 2
   },
   {
    "id": "x",
    "label": "Bob x",
    "unit": "m",
    "expr": "L*sin(theta)"
   },
   {
    "id": "y",
    "label": "Bob y",
    "unit": "m",
    "expr": "-L*cos(theta)"
   },
   {
    "id": "v",
    "label": "Bob speed",
    "unit": "m/s",
    "expr": "L*omega"
   },
   {
    "id": "E",
    "label": "Energy",
    "unit": "J",
    "expr": "m*g*L*(1-cos(theta)) + 0.5*m*v^2",
    "digits": 3
   },
   {
    "id": "rb",
    "label": "Bob radius",
    "unit": "m",
    "expr": "0.05 + 0.05*cbrt(m)"
   },
   {
    "id": "angleDeg",
    "label": "Angle",
    "unit": "°",
    "expr": "deg(theta)",
    "digits": 1
   }
  ],
  "time": {
   "dt": 0.002,
   "speed": 1,
   "duration": 120,
   "resetOn": "paramChange"
  },
  "view": {
   "xmin": -3.3,
   "xmax": 3.3,
   "ymin": -3.4,
   "ymax": 0.5,
   "grid": false
  },
  "shapes": [
   {
    "type": "line",
    "id": "ceiling",
    "x1": -0.6,
    "y1": 0,
    "x2": 0.6,
    "y2": 0,
    "width": 4,
    "color": "muted"
   },
   {
    "type": "line",
    "id": "rest",
    "x1": 0,
    "y1": 0,
    "x2": 0,
    "y2": "-L",
    "width": 1,
    "dash": true,
    "color": "muted"
   },
   {
    "type": "trail",
    "id": "path",
    "x": "x",
    "y": "y",
    "length": 120,
    "color": "accent2"
   },
   {
    "type": "line",
    "id": "rod",
    "x1": 0,
    "y1": 0,
    "x2": "x",
    "y2": "y",
    "width": 2,
    "color": "fg"
   },
   {
    "type": "arrow",
    "id": "vel",
    "x1": "x",
    "y1": "y",
    "x2": "x+0.3*v*cos(theta)",
    "y2": "y+0.3*v*sin(theta)",
    "color": "warn",
    "label": "velocity"
   },
   {
    "type": "circle",
    "id": "bob",
    "x": "x",
    "y": "y",
    "r": "rb",
    "fill": true,
    "color": "accent",
    "label": "bob"
   },
   {
    "type": "circle",
    "id": "pivot",
    "x": 0,
    "y": 0,
    "r": 0.04,
    "fill": true,
    "color": "fg"
   },
   {
    "type": "text",
    "id": "tlabel",
    "x": -3.1,
    "y": 0.25,
    "text": "One swing, there and back: {Tbig:2} s",
    "size": "m",
    "color": "fg"
   }
  ],
  "charts": [
   {
    "id": "angle",
    "type": "time",
    "title": "Angle over time",
    "window": 10,
    "ymin": -90,
    "ymax": 90,
    "series": [
     {
      "expr": "angleDeg",
      "label": "angle",
      "unit": "°",
      "color": "accent"
     }
    ]
   },
   {
    "id": "pvl",
    "type": "sweep",
    "title": "Period vs string length",
    "param": "L",
    "samples": 60,
    "ymin": 0,
    "series": [
     {
      "expr": "Tbig",
      "label": "period",
      "unit": "s",
      "color": "accent2"
     }
    ]
   }
  ],
  "readouts": [
   "Tbig",
   "T0",
   "E"
  ]
 },
 "tour": [
  {
   "id": "t1",
   "title": "Let it swing",
   "set": {
    "L": 1,
    "g": 9.81,
    "theta0": 20,
    "m": 1,
    "b": 0
   },
   "highlight": [
    "bob"
   ],
   "text": "The bob swings back and forth with a steady rhythm. The time for one full swing, there and back, is called the period [S1]."
  },
  {
   "id": "t2",
   "title": "Make the string longer",
   "set": {
    "L": 2.5
   },
   "highlight": [
    "rod"
   ],
   "text": "A longer string makes every swing take longer. For small swings the period is T = 2π√(L/g), so four times the length gives twice the period [S1]."
  },
  {
   "id": "t3",
   "title": "Take it to the Moon",
   "set": {
    "L": 1,
    "g": 1.62
   },
   "highlight": [
    "bob"
   ],
   "text": "The Moon's gravity is about a sixth of Earth's [S3]. The bob is pulled back more gently, so each swing takes about 2.5 times longer."
  },
  {
   "id": "t4",
   "title": "Heavier is not slower",
   "set": {
    "g": 9.81,
    "m": 5
   },
   "highlight": [
    "bob"
   ],
   "text": "A heavier bob is pulled harder by gravity but is also harder to speed up, by exactly the same factor. The period does not change [S1]."
  },
  {
   "id": "t5",
   "title": "Big swings stretch the formula",
   "set": {
    "m": 1,
    "theta0": 75
   },
   "highlight": [
    "tlabel"
   ],
   "text": "The simple formula assumes small angles. Released at 75°, the real period is roughly 12% longer [S1]."
  },
  {
   "id": "t6",
   "title": "Add friction",
   "set": {
    "theta0": 20,
    "b": 0.2
   },
   "highlight": [
    "path"
   ],
   "text": "Friction drains energy, so the swings shrink, but their rhythm barely changes. Pendulum clocks use a small push each swing to replace the lost energy [S2]."
  }
 ],
 "predictions": [
  {
   "id": "p1",
   "question": "You make the string 4 times longer (0.5 m → 2 m). What happens to the time for one swing?",
   "experiment": {
    "from": {
     "L": 0.5
    },
    "to": {
     "L": 2
    },
    "measure": "T0",
    "label": "Period",
    "unit": "s"
   },
   "answer": "increases",
   "explanation": "It doubles, from about 1.42 s to 2.84 s: the period grows with the square root of the length [S1]."
  },
  {
   "id": "p2",
   "question": "You swap a 0.5 kg bob for a 4 kg bob on the same string. The time for one swing…",
   "experiment": {
    "from": {
     "m": 0.5
    },
    "to": {
     "m": 4
    },
    "measure": "Tbig",
    "label": "Period",
    "unit": "s"
   },
   "answer": "same",
   "explanation": "Mass cancels out: gravity's pull and the bob's inertia grow together [S1]."
  },
  {
   "id": "p3",
   "question": "You take the same pendulum from Earth (g = 9.81) to the Moon (g = 1.62). One swing takes…",
   "experiment": {
    "from": {
     "g": 9.81
    },
    "to": {
     "g": 1.62
    },
    "measure": "T0",
    "label": "Period",
    "unit": "s"
   },
   "answer": "increases",
   "explanation": "About 2.5 times longer, because √(9.81/1.62) ≈ 2.46 [S1][S3]."
  }
 ],
 "claims": [
  {
   "id": "c1",
   "text": "For small swings, the period of a simple pendulum is T = 2π√(L/g).",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c2",
   "text": "The period of a simple pendulum does not depend on the mass of the bob.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c3",
   "text": "At larger amplitudes the period is longer than the small-angle formula predicts.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c4",
   "text": "Surface gravity on the Moon is about 1.62 m/s².",
   "sources": [
    "S3"
   ],
   "certainty": "established"
  },
  {
   "id": "c5",
   "text": "This model treats the string as massless and the bob as a point, and models friction as a force proportional to speed.",
   "sources": [],
   "certainty": "simplification"
  }
 ],
 "misconceptions": [
  {
   "wrong": "Heavier pendulums swing more slowly.",
   "right": "Mass cancels out of the motion; only length and gravity set the period [S1]."
  }
 ],
 "glossary": [
  {
   "term": "Period",
   "definition": "The time for one complete swing, there and back."
  },
  {
   "term": "Amplitude",
   "definition": "How far the pendulum swings from its resting position."
  },
  {
   "term": "Gravitational acceleration (g)",
   "definition": "How strongly gravity speeds up falling objects; 9.81 m/s² at Earth's surface."
  },
  {
   "term": "Damping",
   "definition": "Loss of energy, for example to air friction, that makes oscillations shrink."
  }
 ],
 "media": {
  "imagePrompt": "an antique pendulum clock in a quiet wooden workshop, brass pendulum mid-swing, soft morning light"
 },
 "meta": {
  "origin": "gallery"
 }
},
{
 "format": "glassbox-lesson/1",
 "id": "predator-prey",
 "subject": "biology",
 "level": "highschool",
 "language": "en",
 "title": "Why do fox and rabbit numbers rise and fall?",
 "topic": "predator-prey cycles",
 "summary": "Watch foxes and rabbits chase each other through boom and bust, then change the rules and discover what really sets the average numbers.",
 "bigIdea": "In the classic predator-prey model the populations cycle, the predators lag the prey, and each species' average is set by the other species' parameters.",
 "sources": [
  {
   "id": "S1",
   "title": "Lotka–Volterra equations",
   "url": "https://en.wikipedia.org/wiki/Lotka%E2%80%93Volterra_equations",
   "publisher": "Wikipedia",
   "supports": "The equations, the equilibrium R* = γ/δ and F* = α/β, the cycles, predator peaks lagging prey peaks, and the model's idealisations.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S2",
   "title": "Population dynamics",
   "url": "https://en.wikipedia.org/wiki/Population_dynamics",
   "publisher": "Wikipedia",
   "supports": "Context: how populations change through births, deaths and interactions.",
   "retrieved": "2026-11-08"
  }
 ],
 "sim": {
  "kind": "ode",
  "params": [
   {
    "id": "alpha",
    "label": "Rabbit birth rate",
    "unit": "1/yr",
    "min": 0.2,
    "max": 1.5,
    "step": 0.05,
    "value": 0.6,
    "description": "How fast rabbits multiply when there are no foxes."
   },
   {
    "id": "beta",
    "label": "Hunting success",
    "unit": "",
    "min": 0.005,
    "max": 0.03,
    "step": 0.001,
    "value": 0.02,
    "description": "How often a fox meeting a rabbit ends in a catch."
   },
   {
    "id": "delta",
    "label": "Fox growth per rabbit eaten",
    "unit": "",
    "min": 0.002,
    "max": 0.03,
    "step": 0.001,
    "value": 0.01,
    "description": "How well a meal turns into new foxes."
   },
   {
    "id": "gamma",
    "label": "Fox death rate",
    "unit": "1/yr",
    "min": 0.2,
    "max": 1.5,
    "step": 0.05,
    "value": 0.8,
    "description": "How fast foxes die when there is no food."
   },
   {
    "id": "R0",
    "label": "Starting rabbits",
    "unit": "",
    "min": 10,
    "max": 150,
    "step": 5,
    "value": 60
   },
   {
    "id": "F0",
    "label": "Starting foxes",
    "unit": "",
    "min": 2,
    "max": 60,
    "step": 1,
    "value": 15
   }
  ],
  "state": [
   {
    "id": "R",
    "label": "Rabbits",
    "unit": "",
    "initial": "R0",
    "rate": "alpha*R - beta*R*F"
   },
   {
    "id": "F",
    "label": "Foxes",
    "unit": "",
    "initial": "F0",
    "rate": "delta*R*F - gamma*F"
   },
   {
    "id": "Rsum",
    "label": "Rabbit-years",
    "unit": "",
    "initial": "0",
    "rate": "R"
   },
   {
    "id": "Fsum",
    "label": "Fox-years",
    "unit": "",
    "initial": "0",
    "rate": "F"
   }
  ],
  "derived": [
   {
    "id": "Rstar",
    "label": "Balance point: rabbits",
    "unit": "",
    "expr": "gamma/delta",
    "digits": 0
   },
   {
    "id": "Fstar",
    "label": "Balance point: foxes",
    "unit": "",
    "expr": "alpha/beta",
    "digits": 0
   },
   {
    "id": "Ravg",
    "label": "Average rabbits so far",
    "unit": "",
    "expr": "Rsum/max(t,0.001)",
    "digits": 0
   },
   {
    "id": "Favg",
    "label": "Average foxes so far",
    "unit": "",
    "expr": "Fsum/max(t,0.001)",
    "digits": 0
   },
   {
    "id": "nR",
    "label": "Rabbits drawn",
    "unit": "",
    "expr": "min(R,300)"
   },
   {
    "id": "nF",
    "label": "Foxes drawn",
    "unit": "",
    "expr": "min(F,300)"
   }
  ],
  "time": {
   "dt": 0.005,
   "speed": 2,
   "duration": 200,
   "resetOn": "paramChange"
  },
  "view": {
   "xmin": 0,
   "xmax": 10,
   "ymin": 0,
   "ymax": 7,
   "grid": false
  },
  "shapes": [
   {
    "type": "rect",
    "id": "field",
    "x": 0,
    "y": 0,
    "w": 10,
    "h": 6,
    "fill": true,
    "color": "ground"
   },
   {
    "type": "particles",
    "id": "rabbits",
    "x": 0.2,
    "y": 0.2,
    "w": 9.6,
    "h": 5.6,
    "count": "nR",
    "speed": 0.8,
    "r": 3,
    "color": "accent3",
    "fraction": 0,
    "seed": 1
   },
   {
    "type": "particles",
    "id": "foxes",
    "x": 0.2,
    "y": 0.2,
    "w": 9.6,
    "h": 5.6,
    "count": "nF",
    "speed": 1.4,
    "r": 4,
    "color": "warn",
    "fraction": 0,
    "seed": 2
   },
   {
    "type": "text",
    "id": "count",
    "x": 0.2,
    "y": 6.4,
    "text": "Rabbits {R:0} · Foxes {F:0} · year {t:1}",
    "size": "m",
    "color": "fg"
   }
  ],
  "charts": [
   {
    "id": "pops",
    "type": "time",
    "title": "Populations over time",
    "window": 40,
    "ymin": 0,
    "series": [
     {
      "expr": "R",
      "label": "rabbits",
      "color": "accent3"
     },
     {
      "expr": "F",
      "label": "foxes",
      "color": "warn"
     },
     {
      "expr": "Rstar",
      "label": "rabbit balance",
      "color": "muted",
      "dash": true
     }
    ]
   },
   {
    "id": "cycle",
    "type": "phase",
    "title": "Foxes against rabbits",
    "x": "R",
    "y": "F",
    "length": 400,
    "series": [
     {
      "expr": "F",
      "label": "trajectory",
      "color": "accent"
     }
    ]
   }
  ],
  "readouts": [
   "R",
   "F",
   "Ravg",
   "Rstar"
  ]
 },
 "tour": [
  {
   "id": "t1",
   "title": "Boom and bust",
   "set": {
    "alpha": 0.6,
    "beta": 0.02,
    "delta": 0.01,
    "gamma": 0.8,
    "R0": 60,
    "F0": 15
   },
   "highlight": [
    "rabbits"
   ],
   "text": "Press play. Rabbits multiply, foxes feast and multiply too, then the rabbits crash and the foxes starve. The cycle repeats [S1]."
  },
  {
   "id": "t2",
   "title": "Foxes follow rabbits",
   "set": {},
   "highlight": [
    "foxes"
   ],
   "text": "Look at the chart: each fox peak comes a little after the rabbit peak. Predators can only grow once there is plenty of food [S1]."
  },
  {
   "id": "t3",
   "title": "Feed the rabbits",
   "set": {
    "alpha": 0.9
   },
   "highlight": [
    "rabbits"
   ],
   "text": "Rabbits now breed 50% faster. Watch the average: the rabbit average does not rise, but the fox average does [S1]."
  },
  {
   "id": "t4",
   "title": "Start at the balance point",
   "set": {
    "alpha": 0.6,
    "R0": 80,
    "F0": 30
   },
   "highlight": [
    "foxes"
   ],
   "text": "Begin with exactly 80 rabbits and 30 foxes. Nothing changes: this is the equilibrium, where births and deaths cancel [S1]."
  },
  {
   "id": "t5",
   "title": "A model, not a forest",
   "set": {
    "R0": 60,
    "F0": 15
   },
   "highlight": [
    "count"
   ],
   "text": "Real forests have disease, weather and limited grass for rabbits. This model leaves them out on purpose, so real data is noisier and rarely cycles this neatly [S1]."
  }
 ],
 "predictions": [
  {
   "id": "p1",
   "question": "Rabbits start breeding 50% faster (α 0.6 → 0.9). The rabbit balance point (the number the cycle circles around)…",
   "experiment": {
    "from": {
     "alpha": 0.6
    },
    "to": {
     "alpha": 0.9
    },
    "measure": "Rstar",
    "label": "Rabbit balance point",
    "unit": ""
   },
   "answer": "same",
   "explanation": "The rabbit balance point is γ/δ = 80 either way. Extra rabbits feed more foxes, so the fox balance point rises from 30 to 45 [S1]."
  },
  {
   "id": "p2",
   "question": "Foxes start dying faster (γ 0.8 → 1.2). The rabbit balance point…",
   "experiment": {
    "from": {
     "gamma": 0.8
    },
    "to": {
     "gamma": 1.2
    },
    "measure": "Rstar",
    "label": "Rabbit balance point",
    "unit": ""
   },
   "answer": "increases",
   "explanation": "Foxes that die faster need more rabbits to stay in balance: γ/δ goes from 80 to 120 [S1]."
  },
  {
   "id": "p3",
   "question": "Run it for 100 years with α = 0.6, then with α = 0.9. The average number of rabbits over those 100 years…",
   "experiment": {
    "from": {
     "alpha": 0.6
    },
    "to": {
     "alpha": 0.9
    },
    "measure": "Ravg",
    "label": "Average rabbits over 100 years",
    "unit": "",
    "at": {
     "t": 100,
     "agg": "final"
    },
    "tolerance": 0.08
   },
   "answer": "same",
   "explanation": "Faster breeding does not raise the long-run rabbit average. The surplus ends up as more foxes [S1]."
  }
 ],
 "claims": [
  {
   "id": "c1",
   "text": "In the Lotka–Volterra model the populations are in equilibrium at R* = γ/δ rabbits and F* = α/β foxes.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c2",
   "text": "Predator population peaks come after prey population peaks.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c3",
   "text": "Over full cycles the average prey number equals its equilibrium value, which depends on the predator's parameters.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c4",
   "text": "The model ignores limited food for rabbits, disease, weather and migration.",
   "sources": [],
   "certainty": "simplification"
  }
 ],
 "misconceptions": [
  {
   "wrong": "More rabbit babies means more rabbits on average.",
   "right": "In this model extra prey growth ends up as more predators; the prey average stays the same [S1]."
  }
 ],
 "glossary": [
  {
   "term": "Equilibrium",
   "definition": "A state where the numbers stay constant because births and deaths balance."
  },
  {
   "term": "Predator",
   "definition": "An animal that eats others (here, the fox)."
  },
  {
   "term": "Prey",
   "definition": "An animal that is eaten (here, the rabbit)."
  },
  {
   "term": "Population cycle",
   "definition": "A regular rise and fall of numbers over time."
  }
 ],
 "media": {
  "imagePrompt": "a red fox watching hares at the edge of a snowy boreal forest at dawn"
 },
 "meta": {
  "origin": "gallery"
 }
},
{
 "format": "glassbox-lesson/1",
 "id": "equilibrium",
 "subject": "chemistry",
 "level": "highschool",
 "language": "en",
 "title": "Does a catalyst change where a reaction ends up?",
 "topic": "chemical equilibrium and catalysts",
 "summary": "Turn molecules of A into B and back again. Add a catalyst and see whether it changes the final mixture, or only how fast you get there.",
 "bigIdea": "A catalyst speeds up the forward and reverse reactions equally, so the reaction arrives sooner but at the same equilibrium.",
 "sources": [
  {
   "id": "S1",
   "title": "Chemical equilibrium",
   "url": "https://en.wikipedia.org/wiki/Chemical_equilibrium",
   "publisher": "Wikipedia",
   "supports": "At equilibrium the forward and reverse rates are equal; for a one-step reaction K = kf/kb.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S2",
   "title": "Catalysis",
   "url": "https://en.wikipedia.org/wiki/Catalysis",
   "publisher": "Wikipedia",
   "supports": "A catalyst speeds up the forward and reverse reactions equally and does not change the equilibrium position.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S3",
   "title": "Dynamic equilibrium",
   "url": "https://en.wikipedia.org/wiki/Dynamic_equilibrium",
   "publisher": "Wikipedia",
   "supports": "Reactions keep happening at equilibrium; the net amounts stay constant.",
   "retrieved": "2026-11-08"
  }
 ],
 "sim": {
  "kind": "ode",
  "params": [
   {
    "id": "kf",
    "label": "Forward rate constant",
    "unit": "1/s",
    "min": 0.05,
    "max": 2,
    "step": 0.05,
    "value": 0.5,
    "description": "How quickly A turns into B."
   },
   {
    "id": "kb",
    "label": "Reverse rate constant",
    "unit": "1/s",
    "min": 0.05,
    "max": 2,
    "step": 0.05,
    "value": 0.25,
    "description": "How quickly B turns back into A."
   },
   {
    "id": "cat",
    "label": "Catalyst strength",
    "unit": "×",
    "min": 1,
    "max": 10,
    "step": 0.5,
    "value": 1,
    "description": "Speeds up both directions by the same factor."
   },
   {
    "id": "N",
    "label": "Molecules shown",
    "unit": "",
    "min": 40,
    "max": 300,
    "step": 10,
    "value": 150
   }
  ],
  "state": [
   {
    "id": "x",
    "label": "Share of B",
    "unit": "",
    "initial": "0",
    "rate": "cat*(kf*(1-x) - kb*x)"
   }
  ],
  "derived": [
   {
    "id": "K",
    "label": "Equilibrium constant",
    "unit": "",
    "expr": "kf/kb",
    "digits": 2
   },
   {
    "id": "xeq",
    "label": "Equilibrium share of B",
    "unit": "",
    "expr": "kf/(kf+kb)",
    "digits": 3
   },
   {
    "id": "tHalf",
    "label": "Time to get halfway",
    "unit": "s",
    "expr": "ln(2)/(cat*(kf+kb))",
    "digits": 2
   },
   {
    "id": "pctB",
    "label": "B now",
    "unit": "%",
    "expr": "100*x",
    "digits": 0
   },
   {
    "id": "pctEq",
    "label": "B at equilibrium",
    "unit": "%",
    "expr": "100*xeq",
    "digits": 0
   },
   {
    "id": "fwd",
    "label": "Forward rate",
    "unit": "1/s",
    "expr": "cat*kf*(1-x)",
    "digits": 2
   },
   {
    "id": "rev",
    "label": "Reverse rate",
    "unit": "1/s",
    "expr": "cat*kb*x",
    "digits": 2
   }
  ],
  "time": {
   "dt": 0.01,
   "speed": 1,
   "duration": 60,
   "resetOn": "paramChange"
  },
  "view": {
   "xmin": 0,
   "xmax": 10,
   "ymin": 0,
   "ymax": 7.6,
   "grid": false
  },
  "shapes": [
   {
    "type": "rect",
    "id": "box",
    "x": 0,
    "y": 0,
    "w": 10,
    "h": 6,
    "color": "muted"
   },
   {
    "type": "particles",
    "id": "molecules",
    "x": 0.1,
    "y": 0.1,
    "w": 9.8,
    "h": 5.8,
    "count": "N",
    "speed": "0.6+0.3*cat",
    "r": 4,
    "color": "accent",
    "color2": "accent2",
    "fraction": "x",
    "churn": "0.5*(fwd+rev)",
    "seed": 3
   },
   {
    "type": "rect",
    "id": "barB",
    "x": 0,
    "y": 6.4,
    "w": "10*x",
    "h": 0.4,
    "fill": true,
    "color": "accent2"
   },
   {
    "type": "rect",
    "id": "barA",
    "x": "10*x",
    "y": 6.4,
    "w": "10*(1-x)",
    "h": 0.4,
    "fill": true,
    "color": "accent"
   },
   {
    "type": "line",
    "id": "eqmark",
    "x1": "10*xeq",
    "y1": 6.25,
    "x2": "10*xeq",
    "y2": 6.95,
    "width": 2,
    "dash": true,
    "color": "warn",
    "label": "equilibrium"
   },
   {
    "type": "text",
    "id": "pct",
    "x": 0,
    "y": 7.3,
    "text": "B: {pctB:0}% · equilibrium {pctEq:0}%",
    "size": "m",
    "color": "fg"
   }
  ],
  "charts": [
   {
    "id": "share",
    "type": "time",
    "title": "Share of B over time (%)",
    "window": 20,
    "ymin": 0,
    "ymax": 100,
    "series": [
     {
      "expr": "pctB",
      "label": "B",
      "unit": "%",
      "color": "accent2"
     },
     {
      "expr": "pctEq",
      "label": "equilibrium",
      "unit": "%",
      "color": "warn",
      "dash": true
     }
    ]
   },
   {
    "id": "half",
    "type": "sweep",
    "title": "Time to get halfway vs catalyst strength",
    "param": "cat",
    "samples": 60,
    "ymin": 0,
    "series": [
     {
      "expr": "tHalf",
      "label": "halfway time",
      "unit": "s",
      "color": "accent"
     }
    ]
   }
  ],
  "readouts": [
   "pctB",
   "K",
   "tHalf",
   "fwd"
  ]
 },
 "tour": [
  {
   "id": "t1",
   "title": "Start with only A",
   "set": {
    "kf": 0.5,
    "kb": 0.25,
    "cat": 1
   },
   "highlight": [
    "molecules"
   ],
   "text": "Every molecule starts as A (blue). Press play: A turns into B (green) and B turns back into A, until the mix settles [S1]."
  },
  {
   "id": "t2",
   "title": "Equilibrium is busy",
   "set": {},
   "highlight": [
    "molecules"
   ],
   "text": "After a while the colours keep flipping, but the share of B stays put. Forward and reverse rates are equal, so nothing changes overall [S1][S3]."
  },
  {
   "id": "t3",
   "title": "Add a catalyst",
   "set": {
    "cat": 5
   },
   "highlight": [
    "barB"
   ],
   "text": "With a 5× catalyst the mix gets there much sooner, but it ends at the same share of B. A catalyst changes the speed, not the destination [S2]."
  },
  {
   "id": "t4",
   "title": "Push it forward",
   "set": {
    "cat": 1,
    "kf": 1.5
   },
   "highlight": [
    "eqmark"
   ],
   "text": "Raising the forward rate constant moves the end point: more B at equilibrium. Changing the rates unevenly is what shifts the balance [S1]."
  },
  {
   "id": "t5",
   "title": "Speed up the reverse",
   "set": {
    "kf": 0.5,
    "kb": 1.5
   },
   "highlight": [
    "eqmark"
   ],
   "text": "A faster reverse reaction moves the end point the other way, so there is less B at equilibrium [S1]."
  }
 ],
 "predictions": [
  {
   "id": "p1",
   "question": "You add a catalyst that makes both directions 5× faster. After a long time, the share of B…",
   "experiment": {
    "from": {
     "cat": 1
    },
    "to": {
     "cat": 5
    },
    "measure": "x",
    "label": "Share of B after 40 s",
    "unit": "",
    "at": {
     "t": 40,
     "agg": "final"
    }
   },
   "answer": "same",
   "explanation": "Both directions speed up equally, so the balance point stays at about 67% B. The catalyst only gets you there sooner [S2]."
  },
  {
   "id": "p2",
   "question": "With that same catalyst, the time to get halfway to equilibrium…",
   "experiment": {
    "from": {
     "cat": 1
    },
    "to": {
     "cat": 5
    },
    "measure": "tHalf",
    "label": "Time to get halfway",
    "unit": "s"
   },
   "answer": "decreases",
   "explanation": "Everything happens 5 times faster, so the halfway time shrinks to a fifth [S2]."
  },
  {
   "id": "p3",
   "question": "You raise the forward rate constant (0.5 → 1.5) and keep the reverse one. The final share of B…",
   "experiment": {
    "from": {
     "kf": 0.5
    },
    "to": {
     "kf": 1.5
    },
    "measure": "x",
    "label": "Share of B after 40 s",
    "unit": "",
    "at": {
     "t": 40,
     "agg": "final"
    }
   },
   "answer": "increases",
   "explanation": "The equilibrium share is kf/(kf+kb): it grows from about 67% to about 86% [S1]."
  }
 ],
 "claims": [
  {
   "id": "c1",
   "text": "At equilibrium the forward and reverse reaction rates are equal, but the reactions do not stop.",
   "sources": [
    "S1",
    "S3"
   ],
   "certainty": "established"
  },
  {
   "id": "c2",
   "text": "A catalyst speeds up the forward and reverse reactions equally and does not change the equilibrium position.",
   "sources": [
    "S2"
   ],
   "certainty": "established"
  },
  {
   "id": "c3",
   "text": "For a single-step reversible reaction, the equilibrium constant is K = kf/kb.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c4",
   "text": "This model uses one first-order step in each direction at constant temperature.",
   "sources": [],
   "certainty": "simplification"
  }
 ],
 "misconceptions": [
  {
   "wrong": "A catalyst makes more product.",
   "right": "It makes the reaction reach the same equilibrium faster; it does not change how much product there is at the end [S2]."
  }
 ],
 "glossary": [
  {
   "term": "Equilibrium",
   "definition": "The state where forward and reverse reactions happen at the same rate."
  },
  {
   "term": "Catalyst",
   "definition": "A substance that speeds up a reaction without being used up."
  },
  {
   "term": "Rate constant",
   "definition": "A number that says how fast a reaction step goes."
  },
  {
   "term": "Equilibrium constant (K)",
   "definition": "The ratio of forward to reverse rate constants for a single step."
  }
 ],
 "media": {
  "imagePrompt": "glass flasks with two colored liquids mixing on a lab bench, soft window light"
 },
 "meta": {
  "origin": "gallery"
 }
},
{
 "format": "glassbox-lesson/1",
 "id": "seasons",
 "subject": "earth-space",
 "level": "highschool",
 "language": "en",
 "title": "Why is summer warmer? (It's not the distance.)",
 "topic": "the seasons and axial tilt",
 "summary": "Move around the globe and through the year to see how Earth's tilt changes the Sun's height and the length of the day.",
 "bigIdea": "Seasons come from Earth's tilted axis, which changes how high the Sun climbs and how long the day lasts, not from Earth's distance to the Sun.",
 "sources": [
  {
   "id": "S1",
   "title": "Axial tilt",
   "url": "https://en.wikipedia.org/wiki/Axial_tilt",
   "publisher": "Wikipedia",
   "supports": "Earth's axial tilt is about 23.44 degrees.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S2",
   "title": "Season",
   "url": "https://en.wikipedia.org/wiki/Season",
   "publisher": "Wikipedia",
   "supports": "Seasons are caused by Earth's axial tilt, not by its distance from the Sun.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S3",
   "title": "Sunrise equation",
   "url": "https://en.wikipedia.org/wiki/Sunrise_equation",
   "publisher": "Wikipedia",
   "supports": "Day length follows from cos ω₀ = −tan φ · tan δ.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S4",
   "title": "Position of the Sun",
   "url": "https://en.wikipedia.org/wiki/Position_of_the_Sun",
   "publisher": "Wikipedia",
   "supports": "A common approximation for the Sun's declination through the year.",
   "retrieved": "2026-11-08"
  },
  {
   "id": "S5",
   "title": "Apsis",
   "url": "https://en.wikipedia.org/wiki/Apsis",
   "publisher": "Wikipedia",
   "supports": "Earth is closest to the Sun (perihelion) in early January.",
   "retrieved": "2026-11-08"
  }
 ],
 "sim": {
  "kind": "static",
  "params": [
   {
    "id": "lat",
    "label": "Latitude",
    "unit": "°",
    "min": -89,
    "max": 89,
    "step": 0.5,
    "value": 37.5,
    "description": "Positive is north of the equator.",
    "presets": [
     {
      "label": "Equator",
      "value": 0
     },
     {
      "label": "Seoul",
      "value": 37.5
     },
     {
      "label": "Oslo",
      "value": 59.9
     },
     {
      "label": "Sydney",
      "value": -33.9
     },
     {
      "label": "Arctic",
      "value": 75
     }
    ]
   },
   {
    "id": "day",
    "label": "Day of year",
    "unit": "",
    "min": 1,
    "max": 365,
    "step": 1,
    "value": 172,
    "description": "1 is 1 January.",
    "presets": [
     {
      "label": "Mar 20",
      "value": 79
     },
     {
      "label": "Jun 21",
      "value": 172
     },
     {
      "label": "Sep 22",
      "value": 265
     },
     {
      "label": "Dec 21",
      "value": 355
     }
    ]
   },
   {
    "id": "tilt",
    "label": "Axial tilt",
    "unit": "°",
    "min": 0,
    "max": 45,
    "step": 0.5,
    "value": 23.44,
    "description": "How far Earth's axis leans.",
    "presets": [
     {
      "label": "Earth",
      "value": 23.44
     }
    ]
   }
  ],
  "state": [],
  "derived": [
   {
    "id": "decl",
    "label": "Sun's declination",
    "unit": "°",
    "expr": "-tilt*cos(2*pi*(day+10)/365)",
    "digits": 1
   },
   {
    "id": "elev",
    "label": "Noon Sun height",
    "unit": "°",
    "expr": "90 - abs(lat - decl)",
    "digits": 1
   },
   {
    "id": "er",
    "label": "Drawing angle",
    "unit": "rad",
    "expr": "rad(max(elev, 8))"
   },
   {
    "id": "cosH",
    "label": "Sunrise term",
    "unit": "",
    "expr": "-tan(rad(lat))*tan(rad(decl))"
   },
   {
    "id": "dayLen",
    "label": "Daylight",
    "unit": "h",
    "expr": "24/pi*acos(clamp(cosH,-1,1))",
    "digits": 1
   },
   {
    "id": "sunlight",
    "label": "Noon sunlight on flat ground",
    "unit": "",
    "expr": "max(0, sin(rad(elev)))",
    "digits": 2
   },
   {
    "id": "spread",
    "label": "Beam spread",
    "unit": "×",
    "expr": "1/max(sin(rad(elev)), 0.05)",
    "digits": 2
   },
   {
    "id": "pctSun",
    "label": "Noon sunlight (Sun overhead = 100)",
    "unit": "%",
    "expr": "100*sunlight",
    "digits": 0
   },
   {
    "id": "g0",
    "label": "Footprint left",
    "unit": "",
    "expr": "-min(0.9/sin(er), 5)"
   },
   {
    "id": "g2",
    "label": "Footprint right",
    "unit": "",
    "expr": "min(0.9/sin(er), 5)"
   }
  ],
  "time": {
   "dt": 0.01,
   "speed": 1,
   "duration": 60,
   "resetOn": "never",
   "animateParam": {
    "param": "day",
    "rate": 30,
    "loop": true
   }
  },
  "view": {
   "xmin": -9,
   "xmax": 9,
   "ymin": -0.8,
   "ymax": 5.5,
   "grid": false
  },
  "shapes": [
   {
    "type": "rect",
    "id": "ground",
    "x": -9,
    "y": -0.8,
    "w": 18,
    "h": 0.8,
    "fill": true,
    "color": "ground"
   },
   {
    "type": "arrow",
    "id": "ray0",
    "x1": "g0-3.2*cos(er)",
    "y1": "3.2*sin(er)",
    "x2": "g0",
    "y2": 0,
    "width": 2,
    "color": "sun",
    "visible": "elev>0"
   },
   {
    "type": "arrow",
    "id": "ray1",
    "x1": "0-3.2*cos(er)",
    "y1": "3.2*sin(er)",
    "x2": 0,
    "y2": 0,
    "width": 2,
    "color": "sun",
    "visible": "elev>0"
   },
   {
    "type": "arrow",
    "id": "ray2",
    "x1": "g2-3.2*cos(er)",
    "y1": "3.2*sin(er)",
    "x2": "g2",
    "y2": 0,
    "width": 2,
    "color": "sun",
    "visible": "elev>0"
   },
   {
    "type": "circle",
    "id": "sunball",
    "x": "g0-3.9*cos(er)",
    "y": "3.9*sin(er)",
    "r": 0.35,
    "fill": true,
    "color": "sun",
    "visible": "elev>0"
   },
   {
    "type": "line",
    "id": "footprint",
    "x1": "g0",
    "y1": 0.06,
    "x2": "g2",
    "y2": 0.06,
    "width": 6,
    "color": "accent2",
    "label": "lit area",
    "visible": "elev>0"
   },
   {
    "type": "text",
    "id": "info",
    "x": -8.8,
    "y": 5,
    "text": "Noon Sun {elev:0}° up · daylight {dayLen:1} h",
    "size": "m",
    "color": "fg"
   },
   {
    "type": "text",
    "id": "spreadtxt",
    "x": -8.8,
    "y": 4.3,
    "text": "The same beam lights {spread:2}× the ground",
    "size": "m",
    "color": "muted",
    "visible": "elev>0"
   },
   {
    "type": "text",
    "id": "polar",
    "x": -8.8,
    "y": 4.3,
    "text": "Polar night: the Sun stays below the horizon",
    "size": "m",
    "color": "warn",
    "visible": "elev<=0"
   }
  ],
  "charts": [
   {
    "id": "daylen",
    "type": "sweep",
    "title": "Daylight through the year at this latitude (h)",
    "param": "day",
    "samples": 73,
    "ymin": 0,
    "ymax": 24,
    "series": [
     {
      "expr": "dayLen",
      "label": "daylight",
      "unit": "h",
      "color": "accent2"
     }
    ]
   },
   {
    "id": "noon",
    "type": "sweep",
    "title": "Noon sunlight through the year (%)",
    "param": "day",
    "samples": 73,
    "ymin": 0,
    "ymax": 100,
    "series": [
     {
      "expr": "pctSun",
      "label": "noon sunlight",
      "unit": "%",
      "color": "sun"
     }
    ]
   }
  ],
  "readouts": [
   "dayLen",
   "elev",
   "pctSun",
   "decl"
  ]
 },
 "tour": [
  {
   "id": "t1",
   "title": "Summer in Seoul",
   "set": {
    "lat": 37.5,
    "day": 172,
    "tilt": 23.44
   },
   "highlight": [
    "sunball"
   ],
   "text": "On 21 June in Seoul the noon Sun is high and the day is about 14.6 hours long. A high Sun means the same beam is spread over little ground [S2]."
  },
  {
   "id": "t2",
   "title": "Winter in Seoul",
   "set": {
    "day": 355
   },
   "highlight": [
    "footprint"
   ],
   "text": "In December the noon Sun is low, so the same beam spreads over about twice as much ground and the day is shorter. That is why it is colder [S2]."
  },
  {
   "id": "t3",
   "title": "Remove the tilt",
   "set": {
    "tilt": 0,
    "day": 172
   },
   "highlight": [
    "info"
   ],
   "text": "With no tilt, every day is the same: 12 hours of daylight everywhere and no seasons. The tilt is what creates them [S1][S3]."
  },
  {
   "id": "t4",
   "title": "Go north",
   "set": {
    "tilt": 23.44,
    "day": 172,
    "lat": 75
   },
   "highlight": [
    "info"
   ],
   "text": "At 75° north in June the Sun never sets: 24 hours of daylight. The opposite happens in December [S3]."
  },
  {
   "id": "t5",
   "title": "Southern summer",
   "set": {
    "lat": -33.9,
    "day": 355
   },
   "highlight": [
    "sunball"
   ],
   "text": "In Sydney, December is summer. The seasons are opposite in the two hemispheres, because the tilt leans one side toward the Sun while it leans the other side away [S2]."
  },
  {
   "id": "t6",
   "title": "Not the distance",
   "set": {
    "lat": 37.5,
    "day": 3
   },
   "highlight": [
    "ground"
   ],
   "text": "Early January is when Earth is closest to the Sun, yet it is winter in the north [S5]. Distance is not the cause of the seasons [S2]."
  }
 ],
 "predictions": [
  {
   "id": "p1",
   "question": "If Earth had no tilt, Seoul's daylight in late June compared with late December would…",
   "experiment": {
    "from": {
     "tilt": 0,
     "day": 172
    },
    "to": {
     "day": 355
    },
    "measure": "dayLen",
    "label": "Daylight",
    "unit": "h"
   },
   "answer": "same",
   "explanation": "Without a tilt the Sun stays over the equator all year, so every day has 12 hours of daylight [S1][S3]."
  },
  {
   "id": "p2",
   "question": "On 21 June you fly from Seoul (37.5°N) to Oslo (59.9°N). Daylight…",
   "experiment": {
    "from": {
     "lat": 37.5,
     "day": 172
    },
    "to": {
     "lat": 59.9
    },
    "measure": "dayLen",
    "label": "Daylight",
    "unit": "h"
   },
   "answer": "increases",
   "explanation": "Farther north in summer the days are longer, about 14.6 hours in Seoul and 18.4 hours in Oslo [S3]."
  },
  {
   "id": "p3",
   "question": "In Sydney, the noon Sun height in June compared with December…",
   "experiment": {
    "from": {
     "lat": -33.9,
     "day": 355
    },
    "to": {
     "day": 172
    },
    "measure": "elev",
    "label": "Noon Sun height",
    "unit": "°"
   },
   "answer": "decreases",
   "explanation": "December is summer in Sydney, with the noon Sun about 79° high; in June it is only about 33° high [S2]."
  }
 ],
 "claims": [
  {
   "id": "c1",
   "text": "Earth's axial tilt is about 23.44 degrees.",
   "sources": [
    "S1"
   ],
   "certainty": "established"
  },
  {
   "id": "c2",
   "text": "The seasons are caused by Earth's axial tilt, not by its changing distance from the Sun.",
   "sources": [
    "S2"
   ],
   "certainty": "established"
  },
  {
   "id": "c3",
   "text": "Day length follows from cos ω₀ = −tan φ · tan δ, where φ is latitude and δ is the Sun's declination.",
   "sources": [
    "S3"
   ],
   "certainty": "established"
  },
  {
   "id": "c4",
   "text": "The declination formula used here is an approximation of the Sun's real motion.",
   "sources": [
    "S4"
   ],
   "certainty": "simplification"
  },
  {
   "id": "c5",
   "text": "Earth is closest to the Sun in early January.",
   "sources": [
    "S5"
   ],
   "certainty": "established"
  },
  {
   "id": "c6",
   "text": "The model ignores atmospheric refraction and the Sun's disc, so real daylight is a few minutes longer.",
   "sources": [],
   "certainty": "simplification"
  }
 ],
 "misconceptions": [
  {
   "wrong": "Summer is when Earth is closest to the Sun.",
   "right": "Earth is closest in early January; the tilt changes Sun height and day length [S2][S5]."
  }
 ],
 "glossary": [
  {
   "term": "Axial tilt",
   "definition": "The angle between Earth's spin axis and the line perpendicular to its orbit."
  },
  {
   "term": "Declination",
   "definition": "How far north or south of the equator the Sun is overhead on a given day."
  },
  {
   "term": "Latitude",
   "definition": "Your angle north or south of the equator."
  },
  {
   "term": "Solstice",
   "definition": "The day of the year with the longest or shortest daylight."
  }
 ],
 "media": {
  "imagePrompt": "the same countryside village shown in summer and winter side by side, low winter sun versus high summer sun"
 },
 "meta": {
  "origin": "gallery"
 }
}
  ];
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
