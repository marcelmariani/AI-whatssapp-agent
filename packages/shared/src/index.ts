export type UserRole = "admin" | "client";

export interface Customer {
  id: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  address?: Address;
  paymentMethodId?: string;
  tokensRemaining?: number;
}

export interface Address {
  street: string;
  number: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PromptConfig {
  customerId: string;
  whatsappNumber: string;
  prompt: string;
}
