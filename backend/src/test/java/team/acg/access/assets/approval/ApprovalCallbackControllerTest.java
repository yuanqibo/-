package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApprovalCallbackControllerTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ApprovalCallbackRepository repository = mock(ApprovalCallbackRepository.class);
    private final ApprovalCallbackController controller = new ApprovalCallbackController(repository, "WLY5YG");

    @Test
    void durablyAcceptsAValidCallbackAndReportsDuplicates() throws Exception {
        var payload = mapper.readTree("""
            {"eventId":"event-1","eventType":"APPROVAL_STATUS_CHANGED","ownerAppCode":"WLY5YG",
             "approvalNo":"APPROVAL-1","bizNo":"REQ-1","approvalResult":"APPROVED"}
            """);
        when(repository.accept(eq("event-1"), eq("APPROVAL-1"), eq("REQ-1"),
            eq("APPROVAL_STATUS_CHANGED"), any())).thenReturn(true, false);

        assertThat(controller.callback(payload).getBody()).isEqualTo(
            java.util.Map.of("success", true, "accepted", true));
        assertThat(controller.callback(payload).getBody()).isEqualTo(
            java.util.Map.of("success", true, "accepted", false));
        verify(repository, org.mockito.Mockito.times(2)).accept(
            "event-1", "APPROVAL-1", "REQ-1", "APPROVAL_STATUS_CHANGED", payload);
    }

    @Test
    void rejectsCallbacksForAnotherApplication() throws Exception {
        var payload = mapper.readTree("""
            {"eventId":"event-2","eventType":"APPROVAL_STATUS_CHANGED","ownerAppCode":"OTHER",
             "approvalNo":"APPROVAL-2"}
            """);

        assertThatThrownBy(() -> controller.callback(payload))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Approval callback appCode does not match");
    }
}
