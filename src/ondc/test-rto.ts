import 'dotenv/config';
import { ondcQuery } from '~/lib/ondcSql';
import { orderModel } from '~/ondc/models/order.model';
import { flow3CService } from '~/ondc/flows/flow3C.service';
import { becknService } from '~/ondc/services/beckn.service';

async function generateRtoPayload() {
  try {
    const orders = await ondcQuery<any>(
      "SELECT ondc_order_id FROM ondc_orders WHERE status IN ('ORDER_PICKED_UP', 'OUT_FOR_DELIVERY', 'CONFIRMED') LIMIT 1",
    );

    if (!orders || orders.length === 0) {
      console.log('No eligible orders found in the database.');
      process.exit(0);
    }

    const orderId = orders[0].ondc_order_id;
    console.log(`Using order ID from DB: ${orderId}`);

    // Mock transitionStatus to prevent modifying the actual database state
    const originalTransitionStatus = orderModel.transitionStatus;
    orderModel.transitionStatus = async () => {
      console.log('Mocked orderModel.transitionStatus called - DB not modified.');
    };

    // Mock sendCallback to prevent sending actual callback
    const originalSendCallback = becknService.sendCallback;
    becknService.sendCallback = async (
      url: string,
      action: string,
      payload: any,
      txnId: string,
    ) => {
      console.log(`Mocked becknService.sendCallback called for action: ${action}`);
      return { statusCode: 200, error: undefined };
    };

    // Trigger the flow
    await flow3CService.cancelRto(orderId);

    // Restore original functions
    orderModel.transitionStatus = originalTransitionStatus;
    becknService.sendCallback = originalSendCallback;

    console.log('Payload generated and saved to logs/ondc/RTOcancell.log');
    process.exit(0);
  } catch (error) {
    console.error('Error generating payload:', error);
    process.exit(1);
  }
}

generateRtoPayload();
