// The parts of Phorest's API responses the importer reads (third-party API
// v3; see Phorest's published OpenAPI docs for the third-party API).
// Every field is optional: the importer validates rather than trusts.

export type PageMetadata = { size?: number; totalElements?: number; totalPages?: number; number?: number };
export type Paged<K extends string, T> = { _embedded?: Partial<Record<K, T[]>>; page?: PageMetadata };

export type PhorestBranch = {
  branchId?: string;
  name?: string;
  timeZone?: string;
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  currencyCode?: string;
};

export type PhorestStaff = {
  staffId?: string;
  branchId?: string;
  userId?: string;
  staffCategoryId?: string;
  staffCategoryName?: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  email?: string;
  archived?: boolean;
  disqualifiedServices?: string[];
};

// The spec documents LocalTime as an object (a code-generator artifact);
// the API may send "HH:mm:ss" strings. The mapper accepts both.
export type PhorestLocalTime = string | { millisOfDay?: number; hourOfDay?: number; minuteOfHour?: number };

export type PhorestWorkTimeSlot = {
  date?: string;
  startTime?: PhorestLocalTime;
  endTime?: PhorestLocalTime;
  timeOffStartTime?: PhorestLocalTime;
  timeOffEndTime?: PhorestLocalTime;
  type?: "WORKING" | "NON_WORKING" | "NOT_SPECIFIED" | string;
  branchId?: string;
};

export type PhorestWorkTimeTable = { staffId?: string; branchId?: string; timeSlots?: PhorestWorkTimeSlot[] };

export type PhorestService = {
  serviceId?: string;
  archived?: boolean;
  categoryId?: string;
  categoryName?: string;
  duration?: number; // minutes
  gapTime?: number; // minutes
  name?: string;
  price?: number;
  disqualifiedStaff?: string[];
  isAddonOnly?: boolean;
  internetDescription?: string;
  staffCategories?: { prices?: { id?: string; price?: number }[] };
  userDurations?: { userRef?: string; duration?: number }[];
  userGapTimes?: { userRef?: string; gapTime?: number }[];
  userPrices?: { userRef?: string; price?: number }[];
};

export type PhorestServiceCategory = { categoryId?: string; name?: string };

export type PhorestClient = {
  clientId?: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  landLine?: string;
  email?: string;
  notes?: string;
  smsMarketingConsent?: boolean;
  emailMarketingConsent?: boolean;
  preferredStaffId?: string;
  createdAt?: string;
  clientSince?: string;
  archived?: boolean;
  deleted?: boolean;
  banned?: boolean;
  mergedToClientId?: string;
  birthDate?: string;
  gender?: string;
  address?: { streetAddress1?: string; city?: string; postalCode?: string };
  creditAccount?: { outstandingBalance?: number };
  loyaltyCard?: { points?: number };
};

export type PhorestAppointment = {
  appointmentId?: string;
  appointmentDate?: string; // yyyy-MM-dd, branch local
  startTime?: string; // HH:mm:ss, branch local
  endTime?: string;
  price?: number;
  staffId?: string;
  serviceId?: string;
  clientId?: string;
  roomId?: string;
  bookingId?: string;
  state?: "BOOKED" | "CHECKED_IN" | "PAID" | string;
  activationState?: "RESERVED" | "ACTIVE" | "CANCELED" | string;
  depositAmount?: number;
  notes?: string;
  deleted?: boolean;
  source?: string;
  branchId?: string;
};

export type PhorestProduct = {
  productId?: string;
  name?: string;
  brandName?: string;
  categoryName?: string;
  archived?: boolean;
  price?: number;
  minQuantity?: number;
  type?: string;
  barcode?: string;
  code?: string;
  reorderCost?: number;
  quantityInStock?: number;
};

export type PhorestVoucher = {
  voucherId?: string;
  serialNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  clientId?: string;
  originalBalance?: number;
  remainingBalance?: number;
};
