// db/seed.js
// Seeds MizbanYar demo data: 1 user, 1 workspace, 3 properties,
// 10 bookings (incl. one intentional overbooking conflict),
// 3-4 alerts, and 2-3 pricing recommendations.

const { randomUUID } = require('node:crypto');

function isoNow() {
  return new Date().toISOString().replace('Z', '').slice(0, 23) + 'Z';
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed(db) {
  const today = new Date();
  const fmtToday = today.toISOString().slice(0, 10);

  // wipe existing data (idempotent re-seeding for dev)
  const tables = [
    'alerts', 'pricing_recommendations', 'blocked_dates',
    'bookings', 'properties', 'workspace_members', 'workspaces', 'users'
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);

  // ---------------------------------------------------------------
  // user + workspace
  // ---------------------------------------------------------------
  const userId = randomUUID();
  db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, full_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, 'ali@mizbanyar.ir', '09121234567', null, 'علی محمدی');

  const workspaceId = randomUUID();
  db.prepare(`
    INSERT INTO workspaces (id, name, primary_city, owner_id)
    VALUES (?, ?, ?, ?)
  `).run(workspaceId, 'اقامتگاه‌های رویایی شمال', 'رامسر', userId);

  db.prepare(`
    INSERT INTO workspace_members (id, workspace_id, user_id, role)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), workspaceId, userId, 'owner');

  // ---------------------------------------------------------------
  // properties
  // ---------------------------------------------------------------
  const propVilla = randomUUID();
  const propApt = randomUUID();
  const propEco = randomUUID();

  const insertProp = db.prepare(`
    INSERT INTO properties
      (id, workspace_id, name, city, area, type, base_capacity, max_capacity,
       bedrooms_count, beds_count, amenities, base_price, weekend_price,
       min_price, max_price, status, internal_notes)
    VALUES (@id, @workspace_id, @name, @city, @area, @type, @base_capacity, @max_capacity,
            @bedrooms_count, @beds_count, @amenities, @base_price, @weekend_price,
            @min_price, @max_price, @status, @internal_notes)
  `);

  insertProp.run({
    id: propVilla, workspace_id: workspaceId,
    name: 'ویلای استخردار لب دریا - رامسر', city: 'رامسر', area: 'ساحلی',
    type: 'villa', base_capacity: 6, max_capacity: 10,
    bedrooms_count: 3, beds_count: 5,
    amenities: JSON.stringify(['استخر', 'جکوزی', 'پارکینگ', 'وای‌فای', 'باربیکیو']),
    base_price: 3000000, weekend_price: 4500000,
    min_price: 2500000, max_price: 8500000,
    status: 1, internal_notes: 'نزدیک ساحل، نیاز به نظافت بعد از هر رزرو'
  });

  insertProp.run({
    id: propApt, workspace_id: workspaceId,
    name: 'آپارتمان مدرن دوخوابه - تهران جردن', city: 'تهران', area: 'جردن',
    type: 'apartment', base_capacity: 4, max_capacity: 5,
    bedrooms_count: 2, beds_count: 3,
    amenities: JSON.stringify(['وای‌فای', 'پارکینگ', 'آسانسور', 'لباسشویی']),
    base_price: 1800000, weekend_price: 1800000,
    min_price: 1500000, max_price: 2500000,
    status: 1, internal_notes: null
  });

  insertProp.run({
    id: propEco, workspace_id: workspaceId,
    name: 'کلبه سنتی بوم‌گردی - ماسال', city: 'ماسال', area: 'جنگلی',
    type: 'ecotourism', base_capacity: 4, max_capacity: 6,
    bedrooms_count: 2, beds_count: 4,
    amenities: JSON.stringify(['اجاق سنتی', 'چشم‌انداز جنگل', 'پارکینگ']),
    base_price: 1200000, weekend_price: 1800000,
    min_price: 1000000, max_price: 3000000,
    status: 1, internal_notes: 'دسترسی جاده خاکی، در بارش شدید برف بسته می‌شود'
  });

  // ---------------------------------------------------------------
  // bookings (10 total, spanning this month + next month)
  // includes ONE intentional overbooking conflict on propVilla
  // ---------------------------------------------------------------
  const insertBooking = db.prepare(`
    INSERT INTO bookings
      (id, workspace_id, property_id, guest_name, guest_phone,
       check_in_date, check_out_date, guest_count, channel,
       booking_status, total_amount, paid_amount, payment_status, internal_notes)
    VALUES (@id, @workspace_id, @property_id, @guest_name, @guest_phone,
            @check_in_date, @check_out_date, @guest_count, @channel,
            @booking_status, @total_amount, @paid_amount, @payment_status, @internal_notes)
  `);

  const bookings = [
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
      guest_name: 'خانواده احمدی', guest_phone: '09151112233',
      check_in_date: addDays(fmtToday, 2), check_out_date: addDays(fmtToday, 5),
      guest_count: 6, channel: 'jabama', booking_status: 'confirmed',
      total_amount: 13500000, paid_amount: 13500000, payment_status: 'fully_paid',
      internal_notes: null
    },
    {
      // ⚠ INTENTIONAL OVERBOOKING CONFLICT: overlaps with the booking above
      // on the SAME property (propVilla), both 'confirmed'.
      id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
      guest_name: 'آقای رضایی', guest_phone: '09123334455',
      check_in_date: addDays(fmtToday, 3), check_out_date: addDays(fmtToday, 6),
      guest_count: 4, channel: 'whatsapp', booking_status: 'confirmed',
      total_amount: 13500000, paid_amount: 6000000, payment_status: 'deposit_paid',
      internal_notes: 'مهمان از طریق واتساپ رزرو کرد - نیاز به بررسی تداخل با رزرو جاباما'
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
      guest_name: 'خانم کریمی', guest_phone: '09367778899',
      check_in_date: addDays(fmtToday, 10), check_out_date: addDays(fmtToday, 12),
      guest_count: 5, channel: 'instagram', booking_status: 'pending_payment',
      total_amount: 9000000, paid_amount: 0, payment_status: 'unpaid',
      internal_notes: null
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
      guest_name: 'آقای حسینی', guest_phone: '09194445566',
      check_in_date: addDays(fmtToday, 18), check_out_date: addDays(fmtToday, 21),
      guest_count: 8, channel: 'jajiga', booking_status: 'confirmed',
      total_amount: 13500000, paid_amount: 13500000, payment_status: 'fully_paid',
      internal_notes: 'تعطیلات آخر هفته - مهمان VIP'
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propApt,
      guest_name: 'آقای محمدی', guest_phone: '09121119988',
      check_in_date: addDays(fmtToday, 1), check_out_date: addDays(fmtToday, 4),
      guest_count: 3, channel: 'direct_call', booking_status: 'confirmed',
      total_amount: 5400000, paid_amount: 5400000, payment_status: 'fully_paid',
      internal_notes: null
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propApt,
      guest_name: 'خانم نوری', guest_phone: '09301234567',
      check_in_date: addDays(fmtToday, 8), check_out_date: addDays(fmtToday, 10),
      guest_count: 2, channel: 'jabama', booking_status: 'confirmed',
      total_amount: 3600000, paid_amount: 1800000, payment_status: 'deposit_paid',
      internal_notes: null
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propApt,
      guest_name: 'آقای صادقی', guest_phone: '09356667788',
      check_in_date: addDays(fmtToday, 35), check_out_date: addDays(fmtToday, 38),
      guest_count: 4, channel: 'otaghak', booking_status: 'pending_payment',
      total_amount: 5400000, paid_amount: 0, payment_status: 'unpaid',
      internal_notes: null
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propEco,
      guest_name: 'خانواده موسوی', guest_phone: '09171112233',
      check_in_date: addDays(fmtToday, 5), check_out_date: addDays(fmtToday, 7),
      guest_count: 4, channel: 'shab', booking_status: 'confirmed',
      total_amount: 3600000, paid_amount: 3600000, payment_status: 'fully_paid',
      internal_notes: null
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propEco,
      guest_name: 'آقای کاظمی', guest_phone: '09128889900',
      check_in_date: addDays(fmtToday, 15), check_out_date: addDays(fmtToday, 17),
      guest_count: 6, channel: 'instagram', booking_status: 'confirmed',
      total_amount: 3600000, paid_amount: 1800000, payment_status: 'deposit_paid',
      internal_notes: 'درخواست صبحانه محلی اضافه'
    },
    {
      id: randomUUID(), workspace_id: workspaceId, property_id: propEco,
      guest_name: 'خانم رحیمی', guest_phone: '09199990011',
      check_in_date: addDays(fmtToday, -10), check_out_date: addDays(fmtToday, -8),
      guest_count: 3, channel: 'whatsapp', booking_status: 'completed',
      total_amount: 2400000, paid_amount: 2400000, payment_status: 'fully_paid',
      internal_notes: 'رزرو تکمیل‌شده ماه گذشته'
    }
  ];

  for (const b of bookings) insertBooking.run(b);

  // ---------------------------------------------------------------
  // alerts (incl. overbooking conflict + check-in reminder)
  // ---------------------------------------------------------------
  const insertAlert = db.prepare(`
    INSERT INTO alerts
      (id, workspace_id, property_id, booking_id, alert_type, title, description, priority, status)
    VALUES (@id, @workspace_id, @property_id, @booking_id, @alert_type, @title, @description, @priority, @status)
  `);

  insertAlert.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propVilla, booking_id: bookings[1].id,
    alert_type: 'overbooking_conflict',
    title: 'تداخل رزرو در ویلای رامسر',
    description: 'رزرو آقای رضایی (واتساپ) با رزرو خانواده احمدی (جاباما) در ویلای استخردار رامسر تداخل تاریخی دارد. لطفاً فوراً بررسی و یکی را لغو یا جابه‌جا کنید.',
    priority: 'high', status: 'open'
  });

  insertAlert.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propApt, booking_id: bookings[4].id,
    alert_type: 'check_in_today',
    title: 'ورود مهمان فردا - آپارتمان جردن',
    description: 'آقای محمدی فردا وارد آپارتمان جردن می‌شود. وضعیت پرداخت کامل است؛ آماده‌سازی واحد را بررسی کنید.',
    priority: 'medium', status: 'open'
  });

  insertAlert.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propVilla, booking_id: bookings[2].id,
    alert_type: 'pending_payment',
    title: 'پرداخت معلق - خانم کریمی',
    description: 'رزرو خانم کریمی برای ویلای رامسر هنوز پرداختی دریافت نکرده و تاریخ ورود نزدیک است.',
    priority: 'medium', status: 'open'
  });

  insertAlert.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propVilla, booking_id: null,
    alert_type: 'pricing_opportunity',
    title: 'فرصت قیمت‌گذاری - تعطیلات پیش‌رو',
    description: 'تعطیلات رسمی ۲۰ روز دیگر است و قیمت ویلای رامسر هنوز در محدوده عادی تنظیم شده. پیشنهاد می‌شود قیمت افزایش یابد.',
    priority: 'high', status: 'open'
  });

  // ---------------------------------------------------------------
  // pricing recommendations
  // ---------------------------------------------------------------
  const insertRec = db.prepare(`
    INSERT INTO pricing_recommendations
      (id, workspace_id, property_id, target_date, current_price, recommended_price,
       change_percentage, reason, status)
    VALUES (@id, @workspace_id, @property_id, @target_date, @current_price, @recommended_price,
            @change_percentage, @reason, @status)
  `);

  insertRec.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
    target_date: addDays(fmtToday, 20),
    current_price: 4500000, recommended_price: 7000000, change_percentage: 55.5,
    reason: 'به دلیل نزدیک‌شدن تعطیلات رسمی و تقاضای بالای سال گذشته در همین بازه، پیشنهاد می‌شود قیمت ۵۵٪ افزایش یابد.',
    status: 'pending'
  });

  insertRec.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propVilla,
    target_date: addDays(fmtToday, 13),
    current_price: 4500000, recommended_price: 3800000, change_percentage: -15.5,
    reason: 'این تاریخ سه شب متوالی خالی است و کمتر از ۵ روز تا آن باقی مانده. تخفیف لحظه‌آخری احتمال رزرو را افزایش می‌دهد.',
    status: 'pending'
  });

  insertRec.run({
    id: randomUUID(), workspace_id: workspaceId, property_id: propApt,
    target_date: addDays(fmtToday, 6),
    current_price: 1800000, recommended_price: 1800000, change_percentage: 0,
    reason: 'تقاضا و قیمت در محدوده عادی بازار تهران است. نیازی به تغییر نیست.',
    status: 'accepted'
  });

  return { userId, workspaceId, propVilla, propApt, propEco };
}

module.exports = { seed };
