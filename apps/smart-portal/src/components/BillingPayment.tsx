import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/js";
import { PaymentForm } from "./PaymentForm";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLIC_KEY || "pk_test_placeholder"
);

interface BillingPaymentProps {
  clientSecret: string;
  onSuccess: (paymentMethodId: string) => void;
  onError: (error: string) => void;
  isLoading?: boolean;
}

export function BillingPayment({
  clientSecret,
  onSuccess,
  onError,
  isLoading,
}: BillingPaymentProps) {
  const options = {
    clientSecret,
    appearance: {
      theme: "stripe" as const,
      variables: {
        colorPrimary: "#0066cc",
        colorBackground: "#ffffff",
        colorText: "#30313d",
        colorDanger: "#df1b41",
        fontFamily: "Inter, system-ui, sans-serif",
        spacingUnit: "4px",
        borderRadius: "4px",
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm
        clientSecret={clientSecret}
        onSuccess={onSuccess}
        onError={onError}
        isLoading={isLoading}
      />
    </Elements>
  );
}
