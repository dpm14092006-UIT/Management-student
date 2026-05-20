import bcrypt from "bcryptjs";
import { Prisma, Role, TransactionStatus, TransactionType } from "@prisma/client";

import { prisma } from "../src/db";
import { gateSeed, zoneSeed } from "../src/seed-data";

const studentEmails = Array.from({ length: 20 }, (_, index) => {
  const suffix = String(index + 1).padStart(4, "0");
  return `2052${suffix}@gm.uit.edu.vn`;
});

async function main() {
  await prisma.canteenDensity5m.deleteMany();
  await prisma.canteenDensity.deleteMany();
  await prisma.gateStat1m.deleteMany();
  await prisma.gateEvent.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.beacon.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.gate.deleteMany();
  await prisma.canteenZone.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);
  const [admin, lecturer, staff] = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@uit.edu.vn",
        passwordHash,
        fullName: "Nguyen Thi Admin",
        faculty: "Phòng CNTT",
        className: null,
        role: Role.admin
      }
    }),
    prisma.user.create({
      data: {
        email: "lecturer@uit.edu.vn",
        passwordHash,
        fullName: "Tran Van Lecturer",
        faculty: "Khoa Khoa học Máy tính",
        className: null,
        role: Role.lecturer
      }
    }),
    prisma.user.create({
      data: {
        email: "canteen@uit.edu.vn",
        passwordHash,
        fullName: "Le Thi Canteen",
        faculty: "Căng tin",
        className: null,
        role: Role.canteen_staff
      }
    })
  ]);

  const students = await Promise.all(
    studentEmails.map((email, index) =>
      prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: `Sinh viên ${index + 1}`,
          studentCode: `2052${String(index + 1).padStart(4, "0")}`,
          faculty: "Khoa Công nghệ phần mềm",
          className: "SE2024",
          role: Role.student
        }
      })
    )
  );

  await prisma.wallet.createMany({
    data: students.map((student, index) => ({
      userId: student.id,
      balance: new Prisma.Decimal(150000 + index * 5000)
    })).concat([
      { userId: admin.id, balance: new Prisma.Decimal(0) },
      { userId: lecturer.id, balance: new Prisma.Decimal(0) },
      { userId: staff.id, balance: new Prisma.Decimal(0) }
    ])
  });

  const beacon = await prisma.beacon.create({
    data: {
      uuid: "550e8400-e29b-41d4-a716-446655440001",
      roomLabel: "A101"
    }
  });

  const course = await prisma.class.create({
    data: {
      code: "IT001",
      name: "Nhập môn Lập trình",
      roomLabel: "A101",
      beaconId: beacon.id,
      instructorId: lecturer.id,
      schedule: {
        weekday: "Thứ 2",
        startTime: "09:00",
        endTime: "11:00"
      }
    }
  });

  await prisma.enrollment.createMany({
    data: students.map((student) => ({
      classId: course.id,
      userId: student.id
    }))
  });

  const sampleAttendanceDate = new Date();
  sampleAttendanceDate.setUTCHours(0, 0, 0, 0);
  await prisma.attendance.createMany({
    data: students.slice(0, 6).map((student) => ({
      userId: student.id,
      classId: course.id,
      beaconId: beacon.id,
      sessionDate: sampleAttendanceDate,
      checkInTime: new Date(),
      method: "qr"
    }))
  });

  const menuSeed = [
    // Món chính (calories ~400-700)
    { name: "Cơm gà xối mỡ", description: "Cơm tấm với gà chiên giòn, kèm dưa leo và nước mắm chua ngọt.", price: 32000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=600&q=70", prepTimeMin: 12, stockToday: 40, calories: 650, protein: 28, fat: 24, carbs: 78 },
    { name: "Bún bò Huế", description: "Tô bún bò đậm vị sả ớt, thịt bò mềm và chả lụa.", price: 35000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1583224964978-2257b960c3d3?auto=format&fit=crop&w=600&q=70", prepTimeMin: 10, stockToday: 30, calories: 480, protein: 25, fat: 14, carbs: 62 },
    { name: "Phở bò tái", description: "Phở bò truyền thống với nước dùng trong và thịt bò tái.", price: 40000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1576577445504-6af96477db52?auto=format&fit=crop&w=600&q=70", prepTimeMin: 8, stockToday: 35, calories: 420, protein: 26, fat: 8, carbs: 60 },
    { name: "Cơm sườn nướng", description: "Sườn nướng mật ong, cơm tấm thơm, kèm trứng ốp la.", price: 38000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1626804475297-41608ea09aeb?auto=format&fit=crop&w=600&q=70", prepTimeMin: 15, stockToday: 25, calories: 720, protein: 32, fat: 28, carbs: 80 },
    { name: "Bún chả Hà Nội", description: "Chả nướng than hoa, bún tươi và nước chấm pha chuẩn vị.", price: 36000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?auto=format&fit=crop&w=600&q=70", prepTimeMin: 12, stockToday: 28, calories: 540, protein: 24, fat: 18, carbs: 68 },
    { name: "Mì Quảng", description: "Mì Quảng truyền thống với tôm, thịt heo và bánh tráng nướng.", price: 35000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=600&q=70", prepTimeMin: 10, stockToday: 20, calories: 510, protein: 22, fat: 16, carbs: 65 },
    { name: "Hủ tiếu Nam Vang", description: "Hủ tiếu thơm vị nước hầm xương, tôm thịt nhiều topping.", price: 33000, category: "Món chính", imageUrl: "https://images.unsplash.com/photo-1626804475297-41608ea09aeb?auto=format&fit=crop&w=600&q=70", prepTimeMin: 9, stockToday: 30, calories: 470, protein: 23, fat: 12, carbs: 64 },

    // Món phụ (calories ~150-300)
    { name: "Gỏi cuốn tôm thịt", description: "Cuốn gỏi tươi với tôm, thịt heo, bún và rau sống.", price: 18000, category: "Món phụ", imageUrl: "https://images.unsplash.com/photo-1606270842450-39a1b9a4dc5a?auto=format&fit=crop&w=600&q=70", prepTimeMin: 5, stockToday: 40, calories: 180, protein: 12, fat: 3, carbs: 24 },
    { name: "Chả giò chiên", description: "Chả giò vàng giòn, nhân thịt heo và mộc nhĩ.", price: 20000, category: "Món phụ", imageUrl: "https://images.unsplash.com/photo-1625938145744-e380515399b7?auto=format&fit=crop&w=600&q=70", prepTimeMin: 7, stockToday: 50, calories: 290, protein: 9, fat: 16, carbs: 28 },
    { name: "Bánh mì thịt nguội", description: "Bánh mì giòn với pate, chả lụa, dưa chua và rau thơm.", price: 22000, category: "Món phụ", imageUrl: "https://images.unsplash.com/photo-1600891963935-9e9b7d5db82d?auto=format&fit=crop&w=600&q=70", prepTimeMin: 4, stockToday: 60, calories: 380, protein: 14, fat: 12, carbs: 52 },

    // Đồ uống (calories ~50-300)
    { name: "Trà đào cam sả", description: "Trà đào ngon mát kết hợp cam tươi và sả thơm.", price: 18000, category: "Đồ uống", imageUrl: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=600&q=70", prepTimeMin: 3, stockToday: 80, calories: 140, protein: 0, fat: 0, carbs: 35 },
    { name: "Cà phê sữa đá", description: "Cà phê phin truyền thống với sữa đặc.", price: 15000, category: "Đồ uống", imageUrl: "https://images.unsplash.com/photo-1545665277-5937489579f2?auto=format&fit=crop&w=600&q=70", prepTimeMin: 3, stockToday: 100, calories: 180, protein: 3, fat: 6, carbs: 28 },
    { name: "Nước cam ép", description: "Nước cam tươi vắt, không đường, không đá.", price: 20000, category: "Đồ uống", imageUrl: "https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=600&q=70", prepTimeMin: 2, stockToday: 50, calories: 110, protein: 2, fat: 0, carbs: 26 },
    { name: "Sinh tố bơ", description: "Sinh tố bơ xay nhuyễn với sữa tươi và đá.", price: 22000, category: "Đồ uống", imageUrl: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=600&q=70", prepTimeMin: 4, stockToday: 40, calories: 280, protein: 6, fat: 14, carbs: 32 },
    { name: "Trà sữa trân châu", description: "Trà sữa béo thơm, trân châu dai mềm.", price: 25000, category: "Đồ uống", imageUrl: "https://images.unsplash.com/photo-1558857563-c0c6ee6ff8bd?auto=format&fit=crop&w=600&q=70", prepTimeMin: 5, stockToday: 70, calories: 310, protein: 4, fat: 8, carbs: 56 },

    // Tráng miệng (calories ~120-250)
    { name: "Chè đậu xanh", description: "Chè đậu xanh nước cốt dừa béo ngậy.", price: 12000, category: "Tráng miệng", imageUrl: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=70", prepTimeMin: 2, stockToday: 50, calories: 220, protein: 5, fat: 7, carbs: 36 },
    { name: "Sữa chua nếp cẩm", description: "Sữa chua mát lạnh kết hợp nếp cẩm dẻo thơm.", price: 15000, category: "Tráng miệng", imageUrl: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=70", prepTimeMin: 2, stockToday: 40, calories: 180, protein: 6, fat: 4, carbs: 30 },
    { name: "Bánh flan", description: "Bánh flan mịn, caramel đậm vị.", price: 10000, category: "Tráng miệng", imageUrl: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=70", prepTimeMin: 2, stockToday: 60, calories: 160, protein: 4, fat: 5, carbs: 26 }
  ];

  const items = await Promise.all(
    menuSeed.map((item) =>
      prisma.menuItem.create({
        data: {
          name: item.name,
          description: item.description,
          price: new Prisma.Decimal(item.price),
          category: item.category,
          imageUrl: item.imageUrl,
          prepTimeMin: item.prepTimeMin,
          available: true,
          stockToday: item.stockToday,
          calories: item.calories,
          protein: new Prisma.Decimal(item.protein),
          fat: new Prisma.Decimal(item.fat),
          carbs: new Prisma.Decimal(item.carbs)
        }
      })
    )
  );

  const drinkIdx = menuSeed.findIndex((m) => m.name === "Trà đào cam sả");
  const sampleTotal = Number(items[0]!.price) + Number(items[drinkIdx]!.price);

  const order = await prisma.order.create({
    data: {
      userId: students[0]!.id,
      totalAmount: new Prisma.Decimal(sampleTotal),
      pickupTime: new Date(Date.now() + 30 * 60 * 1000),
      status: "ready",
      qrCode: "SCIS-ORDER-SAMPLE",
      pickupToken: "pickup-demo-token",
      items: {
        create: [
          {
            menuItemId: items[0]!.id,
            quantity: 1,
            unitPrice: items[0]!.price
          },
          {
            menuItemId: items[drinkIdx]!.id,
            quantity: 1,
            unitPrice: items[drinkIdx]!.price
          }
        ]
      }
    }
  });

  await prisma.transaction.createMany({
    data: [
      {
        userId: students[0]!.id,
        type: TransactionType.topup,
        amount: new Prisma.Decimal(200000),
        description: "Nạp ví demo",
        status: TransactionStatus.success
      },
      {
        userId: students[0]!.id,
        type: TransactionType.payment,
        amount: new Prisma.Decimal(sampleTotal),
        description: "Thanh toán đơn ăn trưa",
        status: TransactionStatus.success,
        refOrderId: order.id
      }
    ]
  });

  await prisma.gate.createMany({
    data: gateSeed
  });

  await prisma.canteenZone.createMany({
    data: zoneSeed
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
