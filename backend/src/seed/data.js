// The campus the frontend already draws. Geometry matches the SVG/WebGL map so
// the seeded database and the rendered campus are the same nine blocks.
export const buildings = [
  {
    code: "ACAD-A", mapId: "acad", name: "ACADEMIC BLOCK A", type: "ACADEMIC", domain: "Attendance",
    location: "North campus", capacity: 1200, occupancy: 980,
    departments: ["ACADEMIC OFFICE"], geometry: { x: -150, y: -180, w: 150, d: 105, h: 84 }
  },
  {
    code: "HST-A", mapId: "hosta", name: "HOSTEL A", type: "HOSTEL", domain: "Hostel",
    location: "North campus", capacity: 340, occupancy: 318,
    departments: ["MAINTENANCE · PLUMBING", "HOUSEKEEPING"], geometry: { x: 40, y: -180, w: 112, d: 92, h: 104 }
  },
  {
    code: "HST-B", mapId: "hostb", name: "HOSTEL B", type: "HOSTEL", domain: "Water",
    location: "North-east campus", capacity: 330, occupancy: 312,
    departments: ["MAINTENANCE · PLUMBING", "HOUSEKEEPING"], geometry: { x: 212, y: -180, w: 112, d: 92, h: 118 }
  },
  {
    code: "ADMN", mapId: "admin", name: "ADMIN BLOCK", type: "ADMIN", domain: "Admin",
    location: "West campus", capacity: 180, occupancy: 120,
    departments: ["GENERAL ADMINISTRATION"], geometry: { x: -195, y: -20, w: 130, d: 100, h: 70 }
  },
  {
    code: "MESS-C", mapId: "mess", name: "CENTRAL MESS", type: "MESS", domain: "Mess",
    location: "Central campus", capacity: 850, occupancy: 780,
    departments: ["MESS ADMINISTRATION"], geometry: { x: 10, y: -20, w: 148, d: 120, h: 58 }
  },
  {
    code: "HST-C", mapId: "hostc", name: "HOSTEL C", type: "HOSTEL", domain: "Water",
    location: "East campus", capacity: 310, occupancy: 296,
    departments: ["MAINTENANCE · PLUMBING"], geometry: { x: 205, y: -20, w: 112, d: 92, h: 100 }
  },
  {
    code: "SPRT", mapId: "sports", name: "SPORTS AREA", type: "SPORTS", domain: "Facility",
    location: "South-west campus", capacity: 400, occupancy: 90,
    departments: ["GENERAL ADMINISTRATION"], geometry: { x: -195, y: 140, w: 150, d: 125, h: 24 }
  },
  {
    code: "LIB", mapId: "lib", name: "LIBRARY & WI-FI ZONE C", type: "LIBRARY", domain: "Wi-Fi",
    location: "South campus", capacity: 420, occupancy: 260,
    departments: ["IT · NETWORK"], geometry: { x: 10, y: 140, w: 132, d: 108, h: 74 }
  },
  {
    code: "MED", mapId: "med", name: "MEDICAL CENTRE", type: "MEDICAL", domain: "Health",
    location: "South-east campus", capacity: 60, occupancy: 38,
    departments: ["MEDICAL CENTRE"], geometry: { x: 190, y: 140, w: 108, d: 88, h: 52 }
  }
];

export const subjects = [
  ["DATA STRUCTURES", "CS201", 11, 9],
  ["DBMS", "CS203", 9, 6],
  ["OPERATING SYSTEMS", "CS205", 8, 5],
  ["DISCRETE MATHS", "MA201", 7, 6],
  ["DIGITAL ELECTRONICS", "EC201", 7, 4],
  ["COMMUNICATION SKILLS", "HS201", 4, 3]
];

// The seventeen Hostel B water complaints, in eleven different phrasings. This
// is the cluster the whole demo turns on.
export const waterComplaints = [
  ["No water in bathroom, 2nd floor", "No water in the bathroom since morning. Second floor, block B.", 0],
  ["Water not coming in B-214", "There is no water supply in my room B-214 since early morning.", 0.4],
  ["Low water pressure on floor 1", "Water pressure is very low on the first floor taps.", 1.2],
  ["No water supply", "No water supply in the washroom the whole day.", 2.1],
  ["Taps dry in the morning", "The taps are completely dry every morning in hostel B.", 3.0],
  ["Water problem again", "Water problem again on second floor. This is the third time.", 3.6],
  ["No water for bathing", "There is no water for bathing since two days in hostel B.", 4.2],
  ["Bathroom tap not working", "Bathroom tap is not working at all on floor 2.", 5.1],
  ["Water supply stopped", "Water supply stopped completely around 4 am.", 6.0],
  ["No water in washroom", "No water in the washroom, floor 3, since morning.", 6.4],
  ["Pressure very low again", "Water pressure very low again on all floors.", 7.0],
  ["Dry taps floor 3", "Taps on the third floor are dry since yesterday.", 7.2],
  ["Still no water", "Still no water in hostel B. Nobody has come to check.", 8.5],
  ["Water issue not fixed", "The water issue is still not fixed after many complaints.", 9.4],
  ["No water since morning", "No water since morning in the bathroom, second floor.", 11.0],
  ["Water not available", "Water is not available in hostel B washrooms at all.", 12.6],
  ["No water in hostel B", "No water in Hostel B. Fourteen days and no inspection.", 13.8]
];

export const otherComplaints = [
  ["LIB", "WI-FI", "Wi-Fi drops every evening", "The Wi-Fi disconnects every evening in the library zone C.", 4],
  ["LIB", "WI-FI", "Internet keeps disconnecting", "Internet connection keeps disconnecting when the library is full.", 3],
  ["LIB", "WI-FI", "Network very slow", "Network is very slow after 7 pm in zone C.", 2],
  ["LIB", "WI-FI", "Cannot connect to campus wifi", "Cannot connect to the campus wifi router near the reading hall.", 1],
  ["MESS-C", "MESS", "Long queue at lunch", "Very long queue at lunch every day around 1 pm.", 3],
  ["MESS-C", "MESS", "Food finished early", "Food was finished before I reached the mess at 1:20.", 2],
  ["MESS-C", "MESS", "Mess too crowded", "The mess is too crowded in the 13:00 lunch slot.", 1],
  ["ACAD-A", "ATTENDANCE", "Attendance not marked", "My attendance was not marked for the 8 am lab.", 5],
  ["ACAD-A", "ATTENDANCE", "8 am classes hard to attend", "The 8 am classes are hard to attend after night disturbances in hostel.", 2],
  ["MED", "HEALTH", "Long wait at medical centre", "Had to wait very long at the medical centre this week.", 3],
  ["HST-A", "ELECTRICITY", "Fan not working in A-118", "The ceiling fan in room A-118 is not working.", 6],
  ["HST-A", "CLEANLINESS", "Corridor not cleaned", "The second floor corridor has not been cleaned for three days.", 4]
];

export const memories = [
  {
    occurredOn: "2025-08-19", buildingCode: "HST-B", category: "WATER",
    incidentType: "Hostel B water supply failure",
    cause: "Booster pump 1 seal failure — sustained pressure drop",
    resolution: "Seal replaced and pump re-primed", resolutionTimeHours: 3.1,
    outcome: "STABLE", riskBefore: 71, riskAfter: 18, studentSatisfaction: 88,
    recurrence: "None in 30 days", recurrenceCount: 0,
    signatures: ["Booster pump seal failure", "9-complaint cluster", "Resolved in 3.1h", "First of its kind here"]
  },
  {
    occurredOn: "2025-11-04", buildingCode: "HST-B", category: "WATER",
    incidentType: "Hostel B water supply failure",
    cause: "Booster pump 2 failure — pressure fell to 0.4 bar against 1.8 nominal",
    resolution: "Pump 2 impeller replaced, tank sensor recalibrated", resolutionTimeHours: 5.4,
    outcome: "STABLE", riskBefore: 84, riskAfter: 21, studentSatisfaction: 82,
    recurrence: "Recurred after 110 days", recurrenceCount: 1,
    signatures: ["Booster pump 2 failure", "Maintenance delay · 11 days", "14-complaint cluster", "Night-time usage anomaly"]
  },
  {
    occurredOn: "2026-02-22", buildingCode: "HST-B", category: "WATER",
    incidentType: "Hostel B low pressure",
    cause: "Partially blocked inlet strainer", resolution: "Strainer cleaned", resolutionTimeHours: 2.2,
    outcome: "STABLE", riskBefore: 52, riskAfter: 14, studentSatisfaction: 91,
    recurrence: "None in 14 days", recurrenceCount: 2,
    signatures: ["Inlet strainer blockage", "6-complaint cluster", "Resolved in 2.2h"]
  },
  {
    occurredOn: "2026-06-09", buildingCode: "HST-B", category: "WATER",
    incidentType: "Hostel B pump replacement",
    cause: "Booster pump 1 end of service life at 44 months",
    resolution: "Pump replaced with a new unit", resolutionTimeHours: 9.0,
    outcome: "STABLE", riskBefore: 66, riskAfter: 12, studentSatisfaction: 79,
    recurrence: "None in 60 days", recurrenceCount: 3,
    signatures: ["Pump end of service life", "Planned replacement", "Resolved in 9.0h"]
  },
  {
    occurredOn: "2025-12-14", buildingCode: "LIB", category: "WI-FI",
    incidentType: "Wi-Fi zone C session drops",
    cause: "AP cluster C4 saturating above 180 concurrent devices",
    resolution: "Cluster rebalanced across three APs", resolutionTimeHours: 6.5,
    outcome: "MONITORING", riskBefore: 63, riskAfter: 24, studentSatisfaction: 74,
    recurrence: "Recurred after 90 days", recurrenceCount: 0,
    signatures: ["AP saturation above 180 devices", "12-complaint cluster", "Rebalanced in 6.5h"]
  },
  {
    occurredOn: "2026-03-30", buildingCode: "MESS-C", category: "MESS",
    incidentType: "Central mess lunch overload",
    cause: "Two blocks sharing the 13:00 slot after a lab reschedule",
    resolution: "Block C lunch staggered by 20 minutes", resolutionTimeHours: 1.5,
    outcome: "STABLE", riskBefore: 58, riskAfter: 19, studentSatisfaction: 86,
    recurrence: "None in 21 days", recurrenceCount: 0,
    signatures: ["Shared 13:00 slot", "Staggering by 20 minutes", "Waste 8% to 5%"]
  }
];

// Cross-domain chains. Confidences are stored analyst estimates, and every
// response that serves them says so.
export const relationships = [
  {
    chain: "HOSTEL_WATER",
    steps: [
      ["HOSTEL WATER FAILURE", "SLEEP DISRUPTION", 76, "Night Wi-Fi sessions in the affected hostel up 34% over 14 nights"],
      ["SLEEP DISRUPTION", "ATTENDANCE DROP", 84, "08:00 slot attendance down 11 points for that hostel's cohort only"],
      ["ATTENDANCE DROP", "ACADEMIC RISK", 79, "Cohort crossing below the 75% eligibility threshold"]
    ]
  },
  {
    chain: "MESS_HEALTH",
    steps: [
      ["MESS DISSATISFACTION", "MEAL SKIPPING", 68, "Mess utilisation down 12% while complaint volume rose"],
      ["MEAL SKIPPING", "MEDICAL WALK-INS", 61, "Walk-ins up 19% in the week after the dissatisfaction spike"],
      ["MEDICAL WALK-INS", "PERFORMANCE RISK", 55, "Repeat walk-ins correlate with missed morning slots"]
    ]
  },
  {
    chain: "WIFI_ACADEMIC",
    steps: [
      ["WI-FI FAILURE", "REDUCED STUDY ACTIVITY", 72, "Library session length down 28% during AP saturation windows"],
      ["REDUCED STUDY ACTIVITY", "ACADEMIC IMPACT", 64, "Assignment submission timestamps shifting later"],
      ["ACADEMIC IMPACT", "COMPLAINT INCREASE", 70, "Wi-Fi complaint volume rising the week before each assessment"]
    ]
  }
];

// Metric readings the anomaly rules run against.
export const anomalyReadings = [
  { buildingCode: "HST-C", metric: "WATER_DRAW", baseline: 100, current: 77, daysObserved: 9, signalLabel: "Water draw ↓ 23% over 9 days" },
  { buildingCode: "LIB", metric: "WIFI_SESSION_SUCCESS", baseline: 100, current: 84, daysObserved: 4, signalLabel: "Session drops above 180 devices" },
  { buildingCode: "MESS-C", metric: "MESS_SLOT_LOAD", baseline: 100, current: 122, daysObserved: 6, signalLabel: "13:00 load ↑ 22% after lab reschedule" },
  { buildingCode: "MED", metric: "MEDICAL_WALKINS", baseline: 100, current: 119, daysObserved: 7, signalLabel: "Walk-ins ↑ 19%" },
  { buildingCode: "ACAD-A", metric: "ATTENDANCE_0800", baseline: 100, current: 89, daysObserved: 14, signalLabel: "08:00 slot attendance ↓ 11 pts" }
];

export const messSlots = [
  ["11:30", "LUNCH", 120, 3, 4],
  ["12:00", "LUNCH", 310, 5, 5],
  ["12:30", "LUNCH", 612, 6, 7],
  ["13:00", "LUNCH", 780, 8, 12],
  ["13:30", "LUNCH", 690, 8, 10],
  ["14:00", "LUNCH", 420, 6, 6],
  ["14:30", "SNACKS", 210, 4, 3],
  ["15:00", "SNACKS", 90, 3, 2]
];

export const messMenu = [
  { item: "RICE · DALMA · CURD", servings: 9240, takenPercentage: 92 },
  { item: "ROTI · PANEER", servings: 3110, takenPercentage: 78 },
  { item: "EGG CURRY", servings: 2480, takenPercentage: 96 }
];

export const studentNames = [
  ["Pritish Ranjan Sahoo", "HST-B", "B-214"],
  ["Ankita Mohanty", "HST-B", "B-118"],
  ["Rahul Das", "HST-B", "B-302"],
  ["Sneha Patnaik", "HST-A", "A-118"],
  ["Debasish Nayak", "HST-B", "B-207"],
  ["Priyanka Sahu", "HST-C", "C-104"],
  ["Soumya Behera", "HST-B", "B-221"],
  ["Ritesh Panda", "HST-C", "C-219"],
  ["Aishwarya Jena", "HST-A", "A-212"],
  ["Manas Pradhan", "HST-B", "B-115"],
  ["Sasmita Rout", "HST-B", "B-309"],
  ["Abhijit Swain", "HST-C", "C-310"],
  ["Lipsa Barik", "HST-A", "A-107"],
  ["Sourav Mishra", "HST-B", "B-204"],
  ["Nandini Sethi", "HST-B", "B-117"],
  ["Kunal Tripathy", "HST-B", "B-226"],
  ["Ipsita Dash", "HST-C", "C-121"],
  ["Rohit Parida", "HST-B", "B-318"]
];

// ---- attendance timetable --------------------------------------------------
// When each subject meets: [weekday (1 = Monday), slot]. The seed walks back
// from yesterday placing each subject's classes on these days, so the session
// dates and slots in the register follow a real weekly timetable. The class
// counts themselves still come from `subjects` above and are unchanged.
export const subjectSchedule = {
  "DATA STRUCTURES": [[1, "11:00"], [3, "11:00"], [5, "08:00"]],
  DBMS: [[1, "08:00"], [3, "14:00"], [4, "08:00"]],
  "OPERATING SYSTEMS": [[2, "08:00"], [4, "11:00"]],
  "DISCRETE MATHS": [[2, "11:00"], [5, "11:00"]],
  "DIGITAL ELECTRONICS": [[3, "08:00"], [5, "14:00"]],
  "COMMUNICATION SKILLS": [[4, "14:00"]]
};

// Weeks in the teaching semester; planned classes = meetings per week × this.
export const SEMESTER_WEEKS = 16;

// ---- mess: the rest of the day ----------------------------------------------
// Breakfast and dinner slots alongside the lunch and snacks rows in `messSlots`
// (which are kept exactly as they were). Same shape:
// [time, meal, baseCrowd, queueMinutes, wastePercent].
export const messExtraSlots = [
  ["07:30", "BREAKFAST", 180, 3, 9],
  ["08:00", "BREAKFAST", 420, 5, 8],
  ["08:30", "BREAKFAST", 470, 6, 7],
  ["09:00", "BREAKFAST", 210, 3, 10],
  ["19:30", "DINNER", 380, 4, 6],
  ["20:00", "DINNER", 640, 7, 5],
  ["20:30", "DINNER", 590, 7, 6],
  ["21:00", "DINNER", 260, 3, 9]
];

// A weekly rotation per meal, indexed by weekday (0 = Sunday). Each item is
// [name, servingsPlanned, takenPercentage, soldOutAt | null].
export const messRotation = {
  BREAKFAST: [
    [["POORI · ALOO", 1800, 94, null], ["TEA · COFFEE", 2100, 81, null]],
    [["IDLI · SAMBAR", 1900, 83, null], ["TEA · COFFEE", 2100, 79, null]],
    [["UPMA", 1700, 64, null], ["BREAD · EGG", 900, 97, "08:40"]],
    [["IDLI · SAMBAR", 1900, 82, null], ["TEA · COFFEE", 2100, 80, null]],
    [["PARATHA · CURD", 1800, 91, null], ["TEA · COFFEE", 2100, 78, null]],
    [["UPMA", 1700, 61, null], ["BREAD · EGG", 900, 96, "08:35"]],
    [["CHOLE BHATURE", 1800, 95, null], ["TEA · COFFEE", 2100, 83, null]]
  ],
  LUNCH: [
    [["RICE · DALMA · CURD", 3100, 90, null], ["CHICKEN CURRY", 1500, 97, null]],
    [["RICE · DALMA · CURD", 3100, 92, null], ["ROTI · PANEER", 1400, 78, null]],
    [["RICE · DAL · SABJI", 3100, 84, null], ["ROTI · PANEER", 1400, 81, null]],
    [["RICE · DALMA · CURD", 3100, 91, null], ["EGG CURRY", 1300, 98, "13:20"]],
    [["RICE · RAJMA", 3100, 88, null], ["ROTI · PANEER", 1400, 80, null]],
    [["RICE · DAL · SABJI", 3100, 83, null], ["FISH CURRY", 1200, 93, null]],
    [["RICE · DALMA · CURD", 3100, 90, null], ["EGG CURRY", 1300, 99, "13:15"]]
  ],
  SNACKS: [
    [["SAMOSA · TEA", 900, 88, null]], [["BISCUITS · TEA", 900, 62, null]], [["PAKODA · TEA", 900, 85, null]],
    [["BISCUITS · TEA", 900, 60, null]], [["SAMOSA · TEA", 900, 87, null]], [["BISCUITS · TEA", 900, 63, null]],
    [["PAKODA · TEA", 900, 84, null]]
  ],
  DINNER: [
    [["BIRYANI", 2400, 96, "20:50"], ["RAITA", 2400, 70, null]],
    [["ROTI · DAL · SABJI", 2300, 72, null], ["RICE", 2300, 76, null]],
    [["ROTI · PANEER", 2300, 86, null], ["RICE · DAL", 2300, 74, null]],
    [["ROTI · DAL · SABJI", 2300, 70, null], ["RICE", 2300, 75, null]],
    [["ROTI · CHICKEN", 2300, 93, null], ["RICE · DAL", 2300, 73, null]],
    [["ROTI · DAL · SABJI", 2300, 71, null], ["KHICHDI", 2300, 66, null]],
    [["FRIED RICE · MANCHURIAN", 2400, 94, "20:40"], ["SOUP", 2400, 58, null]]
  ]
};

// Demo feedback comments, grouped by what a student is reacting to. The seed
// picks from these; the themes and sentiment stored on each row are computed
// by messIntelligenceService.classifyFeedback, not copied from here.
export const messFeedbackTemplates = {
  good: [
    ["Tasty food today, really enjoyed it.", 5],
    ["The curry was delicious and fresh.", 5],
    ["Good taste and hot food, thanks.", 4],
    ["Nice variety today.", 4],
    ["Clean plates and good service.", 4],
    ["", 4],
    ["", 5]
  ],
  taste: [
    ["The dal was bland and tasteless.", 2],
    ["Too much oil and salt in the sabji.", 2],
    ["Food taste was bad today.", 1],
    ["Sabji was too spicy.", 3]
  ],
  quantity: [
    ["Portion was too small, still hungry.", 2],
    ["Quantity of rice was not enough.", 2],
    ["They gave very less paneer, portion too small.", 2],
    ["Second helping refused, quantity is less.", 2]
  ],
  variety: [
    ["Same menu again, no variety.", 3],
    ["Same food every week, please change the menu.", 2]
  ],
  temperature: [
    ["The idli was cold.", 2],
    ["Food was served cold.", 2],
    ["Tea was lukewarm.", 3]
  ],
  hygiene: [
    ["Found a hair in the food.", 1],
    ["Plates were not clean.", 2]
  ],
  queue: [
    ["Very long queue, waited 20 minutes.", 2],
    ["Too crowded at 1 pm, no seats.", 2]
  ],
  availability: [
    ["Egg curry finished before I reached.", 2],
    ["Food ran out early, nothing left.", 1]
  ]
};
