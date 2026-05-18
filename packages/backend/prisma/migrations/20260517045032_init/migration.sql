-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'admin', 'lecturer', 'canteen_staff');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('ble', 'qr', 'manual');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('topup', 'payment', 'refund');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('success', 'pending', 'failed');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'preparing', 'ready', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "GateDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "GateMethod" AS ENUM ('qr', 'rfid', 'face', 'manual');

-- CreateEnum
CREATE TYPE "DensitySource" AS ENUM ('sensor', 'camera', 'order_proxy', 'manual');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "studentCode" TEXT,
    "faculty" TEXT,
    "className" TEXT,
    "photoUrl" TEXT,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'success',
    "refOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomLabel" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "instructorId" TEXT NOT NULL,
    "beaconId" TEXT,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("classId","userId")
);

-- CreateTable
CREATE TABLE "Beacon" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "roomLabel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Beacon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "beaconId" TEXT,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "checkInTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "AttendanceMethod" NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "category" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "prepTimeMin" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "stockToday" INTEGER NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "pickupTime" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "qrCode" TEXT NOT NULL,
    "pickupToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("orderId","menuItemId")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" BIGSERIAL NOT NULL,
    "gateId" TEXT NOT NULL,
    "userId" TEXT,
    "direction" "GateDirection" NOT NULL,
    "method" "GateMethod" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateStat1m" (
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "gateId" TEXT NOT NULL,
    "inCount" INTEGER NOT NULL,
    "outCount" INTEGER NOT NULL,

    CONSTRAINT "GateStat1m_pkey" PRIMARY KEY ("bucketStart","gateId")
);

-- CreateTable
CREATE TABLE "CanteenZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "xMin" INTEGER NOT NULL,
    "yMin" INTEGER NOT NULL,
    "xMax" INTEGER NOT NULL,
    "yMax" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CanteenZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenDensity" (
    "id" BIGSERIAL NOT NULL,
    "zoneId" TEXT NOT NULL,
    "occupied" INTEGER NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "source" "DensitySource" NOT NULL,

    CONSTRAINT "CanteenDensity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenDensity5m" (
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "zoneId" TEXT NOT NULL,
    "avgOccupied" DECIMAL(6,2) NOT NULL,
    "peakOccupied" INTEGER NOT NULL,

    CONSTRAINT "CanteenDensity5m_pkey" PRIMARY KEY ("bucketStart","zoneId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentCode_key" ON "User"("studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_code_key" ON "Class"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Beacon_uuid_key" ON "Beacon"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_classId_sessionDate_key" ON "Attendance"("userId", "classId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_code_key" ON "Gate"("code");

-- CreateIndex
CREATE INDEX "GateEvent_occurredAt_idx" ON "GateEvent"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "GateEvent_gateId_occurredAt_idx" ON "GateEvent"("gateId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CanteenZone_code_key" ON "CanteenZone"("code");

-- CreateIndex
CREATE INDEX "CanteenDensity_measuredAt_idx" ON "CanteenDensity"("measuredAt" DESC);

-- CreateIndex
CREATE INDEX "CanteenDensity_zoneId_measuredAt_idx" ON "CanteenDensity"("zoneId", "measuredAt" DESC);

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refOrderId_fkey" FOREIGN KEY ("refOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_beaconId_fkey" FOREIGN KEY ("beaconId") REFERENCES "Beacon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_beaconId_fkey" FOREIGN KEY ("beaconId") REFERENCES "Beacon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateStat1m" ADD CONSTRAINT "GateStat1m_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenDensity" ADD CONSTRAINT "CanteenDensity_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CanteenZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenDensity5m" ADD CONSTRAINT "CanteenDensity5m_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CanteenZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
