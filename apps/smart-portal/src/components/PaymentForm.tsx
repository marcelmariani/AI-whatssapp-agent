import { useState } from "react";
import { useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";
import { StripePaymentElementOptions } from "@stripe/stripe-js";

interface PaymentFormProps {
  clientSecret: string;
  onSuccess: (paymentMethodId: string) => void;
  onError: (error: string) => void;
  isLoading?: boolean;
}

export function PaymentForm({ clientSecret, onSuccess, onError, isLoading = false }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setMessage("Stripe não está carregado");
      return;
    }

    setIsProcessing(true);
    setMessage(null);

    try {
      // Confirmar SetupIntent
      const { setupIntent, error } = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required", // Não redireciona
      });

      if (error) {
        setMessage(error.message || "Erro ao processar cartão");
        onError(error.message || "Erro ao processar cartão");
        setIsProcessing(false);
        return;
      }

      if (setupIntent?.status === "succeeded") {
        // SetupIntent confirmado com sucesso
        const paymentMethodId = setupIntent.payment_method;
        
        if (typeof paymentMethodId === "string") {
          setMessage("Cartão adicionado com sucesso!");
          onSuccess(paymentMethodId);
        } else if (typeof paymentMethodId === "object" && paymentMethodId?.id) {
          setMessage("Cartão adicionado com sucesso!");
          onSuccess(paymentMethodId.id);
        }
      } else if (setupIntent?.status === "processing") {
        setMessage("Processando seu cartão...");
      } else if (setupIntent?.status === "requires_action") {
        setMessage("Autenticação adicional necessária");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Erro desconhecido";
      setMessage(errorMessage);
      onError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const paymentElementOptions: StripePaymentElementOptions = {
    layout: "tabs",
    defaultValues: {
      billingDetails: {
        name: "", // Preenchido pelo usuário
      },
    },
  };

  return (
    <div className="payment-form-container">
      <form onSubmit={handleSubmit} className="payment-form">
        <div className="payment-element-wrapper">
          <PaymentElement options={paymentElementOptions} />
        </div>

        {message && (
          <div className={`message ${message.includes("sucesso") ? "success" : "error"}`}>
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={isProcessing || isLoading || !stripe || !elements}
          className="payment-submit-btn"
        >
          {isProcessing ? "Processando..." : isLoading ? "Carregando..." : "Salvar Cartão"}
        </button>
      </form>
    </div>
  );
}
