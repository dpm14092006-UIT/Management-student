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

  const items = await Promise.all([
    prisma.menuItem.create({
      data: {
        name: "Cơm gà xối mỡ",
        description: "Phần cơm gà nóng, ăn nhanh cho giờ trưa.",
        price: new Prisma.Decimal(32000),
        category: "Món chính",
        imageUrl: "https://images.unsplash.com/photo-1604908176997-4316f8d17cb5?auto=format&fit=crop&w=800&q=80",
        prepTimeMin: 12,
        available: true,
        stockToday: 40
      }
    }),
    prisma.menuItem.create({
      data: {
        name: "Bún bò",
        description: "Tô bún bò đậm vị, phục vụ nhanh.",
        price: new Prisma.Decimal(35000),
        category: "Món chính",
        imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80",
        prepTimeMin: 10,
        available: true,
        stockToday: 25
      }
    }),
    prisma.menuItem.create({
      data: {
        name: "Trà đào",
        description: "Trà đào mát lạnh, ít ngọt.",
        price: new Prisma.Decimal(8000),
        category: "Đồ uống",
        imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80",
        prepTimeMin: 2,
        available: true,
        stockToday: 50
      }
    })
  ]);

  const order = await prisma.order.create({
    data: {
      userId: students[0]!.id,
      totalAmount: new Prisma.Decimal(40000),
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
            menuItemId: items[2]!.id,
            quantity: 1,
            unitPrice: items[2]!.price
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
        amount: new Prisma.Decimal(40000),
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
