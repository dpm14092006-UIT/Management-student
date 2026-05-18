export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  studentCode?: string | null;
  faculty?: string | null;
  className?: string | null;
  walletBalance?: number;
};

export type Session = {
  access: string;
  refresh: string;
  user: SessionUser;
};
