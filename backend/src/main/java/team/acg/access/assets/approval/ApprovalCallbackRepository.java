package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PostConstruct;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Repository
public class ApprovalCallbackRepository {
    private static final int MAX_ATTEMPTS = 8;
    private final JdbcTemplate jdbc;

    public ApprovalCallbackRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS approval_callback_event (
              event_id VARCHAR(191) PRIMARY KEY,
              approval_no VARCHAR(191) NOT NULL,
              biz_no VARCHAR(191) NOT NULL,
              event_type VARCHAR(64) NOT NULL,
              payload LONGTEXT NOT NULL,
              processing_status VARCHAR(16) NOT NULL,
              attempts INT NOT NULL,
              next_attempt_at TIMESTAMP(3) NOT NULL,
              received_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              processed_at TIMESTAMP(3),
              last_error VARCHAR(1000) NOT NULL,
              INDEX idx_approval_callback_pending (processing_status, next_attempt_at),
              INDEX idx_approval_callback_approval (approval_no)
            )
            """);
    }

    public boolean accept(String eventId, String approvalNo, String bizNo, String eventType, JsonNode payload) {
        Instant now = Instant.now();
        try {
            jdbc.update("INSERT INTO approval_callback_event "
                    + "(event_id, approval_no, biz_no, event_type, payload, processing_status, attempts, "
                    + "next_attempt_at, received_at, updated_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                eventId, approvalNo, bizNo, eventType, payload.toString(), "PENDING", 0,
                Timestamp.from(now), Timestamp.from(now), Timestamp.from(now), "");
            return true;
        } catch (DuplicateKeyException ignored) {
            return false;
        }
    }

    public List<Event> claimBatch(int limit) {
        Instant now = Instant.now();
        Instant stale = now.minus(Duration.ofMinutes(5));
        List<Event> candidates = jdbc.query("SELECT event_id, approval_no, biz_no, event_type, payload, attempts "
                + "FROM approval_callback_event WHERE "
                + "((processing_status IN ('PENDING','FAILED') AND next_attempt_at <= ?) "
                + "OR (processing_status = 'PROCESSING' AND updated_at < ?)) "
                + "ORDER BY received_at LIMIT ?",
            (rs, row) -> new Event(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getInt(6) + 1), Timestamp.from(now), Timestamp.from(stale), limit);
        return candidates.stream().filter(event -> claim(event.eventId(), now)).toList();
    }

    public void processed(String eventId) {
        Instant now = Instant.now();
        jdbc.update("UPDATE approval_callback_event SET processing_status = 'PROCESSED', processed_at = ?, "
                + "updated_at = ?, last_error = '' WHERE event_id = ? AND processing_status = 'PROCESSING'",
            Timestamp.from(now), Timestamp.from(now), eventId);
    }

    public void failed(Event event, Exception error) {
        Instant now = Instant.now();
        boolean dead = event.attempts() >= MAX_ATTEMPTS;
        long delaySeconds = Math.min(300, 1L << Math.min(event.attempts(), 8));
        jdbc.update("UPDATE approval_callback_event SET processing_status = ?, next_attempt_at = ?, "
                + "updated_at = ?, last_error = ? WHERE event_id = ? AND processing_status = 'PROCESSING'",
            dead ? "DEAD" : "FAILED", Timestamp.from(now.plusSeconds(delaySeconds)), Timestamp.from(now),
            message(error), event.eventId());
    }

    private boolean claim(String eventId, Instant now) {
        Instant stale = now.minus(Duration.ofMinutes(5));
        return jdbc.update("UPDATE approval_callback_event SET processing_status = 'PROCESSING', attempts = attempts + 1, "
                + "updated_at = ? WHERE event_id = ? AND ((processing_status IN ('PENDING','FAILED') AND next_attempt_at <= ?) "
                + "OR (processing_status = 'PROCESSING' AND updated_at < ?))",
            Timestamp.from(now), eventId, Timestamp.from(now), Timestamp.from(stale)) == 1;
    }

    private String message(Exception error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 1000 ? value : value.substring(0, 1000);
    }

    public record Event(String eventId, String approvalNo, String bizNo, String eventType,
                        String payload, int attempts) {}
}
