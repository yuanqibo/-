package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public class ApprovalRequestRepository {
    private static final Set<String> OPEN_STATUSES = Set.of("审批中", "待审批", "待执行");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ApprovalRequestRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS approval_request_record (
              request_id VARCHAR(191) PRIMARY KEY,
              request_type VARCHAR(64) NOT NULL,
              request_status VARCHAR(32) NOT NULL,
              applicant_subject VARCHAR(191) NOT NULL,
              applicant_directory_subject VARCHAR(191) NOT NULL,
              approval_no VARCHAR(191) NOT NULL,
              biz_no VARCHAR(191) NOT NULL,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              INDEX idx_approval_request_status (request_status),
              INDEX idx_approval_request_applicant (applicant_subject),
              INDEX idx_approval_request_approval_no (approval_no),
              INDEX idx_approval_request_biz_no (biz_no)
            )
            """);
    }

    public RequestRecord create(ObjectNode request) {
        Instant now = Instant.now();
        jdbc.update("INSERT INTO approval_request_record "
                + "(request_id, request_type, request_status, applicant_subject, applicant_directory_subject, "
                + "approval_no, biz_no, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            request.path("id").asText(), request.path("type").asText(), request.path("status").asText(),
            request.path("applicantSubject").asText(""), request.path("applicantDirectorySubject").asText(""),
            request.path("approvalNo").asText(""), request.path("bizNo").asText(""), request.toString(), 1L,
            Timestamp.from(now), Timestamp.from(now));
        return new RequestRecord(request.deepCopy(), 1L, now, now);
    }

    public boolean createIfAbsent(ObjectNode request) {
        try {
            create(request);
            return true;
        } catch (DuplicateKeyException ignored) {
            return false;
        }
    }

    public List<ObjectNode> findAll() {
        return jdbc.query("SELECT document FROM approval_request_record ORDER BY created_at DESC, request_id DESC",
            (rs, row) -> read(rs.getString(1)));
    }

    public Optional<ObjectNode> find(String requestId) {
        return jdbc.query("SELECT document FROM approval_request_record WHERE request_id = ?", rs ->
            rs.next() ? Optional.of(read(rs.getString(1))) : Optional.empty(), requestId);
    }

    public Optional<RequestRecord> findForUpdate(String requestId) {
        return queryOne("SELECT document, version, created_at, updated_at FROM approval_request_record "
            + "WHERE request_id = ? FOR UPDATE", requestId);
    }

    public Optional<RequestRecord> findByApprovalForUpdate(String approvalNo, String bizNo) {
        List<Object> arguments = new ArrayList<>();
        StringBuilder sql = new StringBuilder(
            "SELECT document, version, created_at, updated_at FROM approval_request_record WHERE ");
        if (!approvalNo.isBlank()) {
            sql.append("approval_no = ?");
            arguments.add(approvalNo);
        }
        if (!bizNo.isBlank()) {
            if (!arguments.isEmpty()) sql.append(" OR ");
            sql.append("biz_no = ? OR request_id = ?");
            arguments.add(bizNo);
            arguments.add(bizNo);
        }
        sql.append(" ORDER BY created_at DESC LIMIT 1 FOR UPDATE");
        return queryOne(sql.toString(), arguments.toArray());
    }

    public RequestRecord update(RequestRecord current, ObjectNode request) {
        Instant now = Instant.now();
        int changed = jdbc.update("UPDATE approval_request_record SET request_type = ?, request_status = ?, "
                + "applicant_subject = ?, applicant_directory_subject = ?, approval_no = ?, biz_no = ?, document = ?, "
                + "version = version + 1, updated_at = ? WHERE request_id = ? AND version = ?",
            request.path("type").asText(), request.path("status").asText(), request.path("applicantSubject").asText(""),
            request.path("applicantDirectorySubject").asText(""), request.path("approvalNo").asText(""),
            request.path("bizNo").asText(""), request.toString(), Timestamp.from(now), request.path("id").asText(),
            current.version());
        if (changed != 1) throw new IllegalStateException("Approval request changed while it was locked");
        return new RequestRecord(request.deepCopy(), current.version() + 1, current.createdAt(), now);
    }

    public List<String> pendingApprovalNos(int limit) {
        if (limit <= 0) return List.of();
        List<String> statuses = OPEN_STATUSES.stream().sorted().toList();
        String placeholders = String.join(",", java.util.Collections.nCopies(statuses.size(), "?"));
        List<Object> arguments = new ArrayList<>(statuses);
        arguments.add(limit);
        return jdbc.query("SELECT approval_no FROM approval_request_record WHERE approval_no <> '' "
                + "AND request_status IN (" + placeholders + ") ORDER BY updated_at ASC LIMIT ?",
            (rs, row) -> rs.getString(1), arguments.toArray());
    }

    public long revision() {
        Long revision = jdbc.queryForObject("SELECT COALESCE(SUM(version), 0) FROM approval_request_record", Long.class);
        return revision == null ? 0 : revision;
    }

    public long count() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM approval_request_record", Long.class);
        return count == null ? 0 : count;
    }

    public boolean exists(String requestId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM approval_request_record WHERE request_id = ?", Integer.class, requestId);
        return count != null && count == 1;
    }

    public int deleteAll() {
        return jdbc.update("DELETE FROM approval_request_record");
    }

    private Optional<RequestRecord> queryOne(String sql, Object... arguments) {
        return jdbc.query(sql, rs -> rs.next()
            ? Optional.of(new RequestRecord(read(rs.getString(1)), rs.getLong(2),
                rs.getTimestamp(3).toInstant(), rs.getTimestamp(4).toInstant()))
            : Optional.empty(), arguments);
    }

    private ObjectNode read(String value) {
        try {
            return (ObjectNode) mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Approval request document is invalid", error);
        }
    }

    public record RequestRecord(ObjectNode document, long version, Instant createdAt, Instant updatedAt) {}
}
