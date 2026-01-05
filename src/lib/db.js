import { supabase } from "../supabaseClient";

function assertNoError(error, context) {
  if (error) {
    const msg = `[Supabase] ${context}: ${error.message}`;
    console.error(msg, error);
    throw new Error(msg);
  }
}

export async function getDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("id,name")
    .order("name", { ascending: true });

  assertNoError(error, "getDepartments");
  return data ?? [];
}

export async function getEmployees({ departmentId } = {}) {
  let q = supabase.from("employees").select("id,full_name,department_id");
  if (departmentId) q = q.eq("department_id", departmentId);

  const { data, error } = await q.order("full_name", { ascending: true });
  assertNoError(error, "getEmployees");
  return data ?? [];
}

export async function createLeaveRequest({
  employeeId,
  departmentId,
  startDate,
  endDate,
  reason,
}) {
  const { data, error } = await supabase
    .from("leave_requests")
    .insert([
      {
        employee_id: employeeId,
        department_id: departmentId,
        start_date: startDate,
        end_date: endDate,
        reason: reason || null,
        status: "pending",
      },
    ])
    .select("id")
    .single();

  assertNoError(error, "createLeaveRequest");
  return data;
}

export async function getLeaveRequests({ status, departmentId } = {}) {
  let q = supabase
    .from("leave_requests")
    .select(`
      id,
      employee_id,
      department_id,
      start_date,
      end_date,
      reason,
      status,
      created_at,
      employees ( full_name )
    `)
    .order("created_at", { ascending: false });

  if (status) q = q.eq("status", status);
  if (departmentId) q = q.eq("department_id", departmentId);

  const { data, error } = await q;
  assertNoError(error, "getLeaveRequests");
  return data ?? [];
}

export async function setLeaveRequestStatus({ requestId, status }) {
  if (!["approved", "rejected", "pending"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const { error } = await supabase
    .from("leave_requests")
    .update({ status })
    .eq("id", requestId);

  assertNoError(error, "setLeaveRequestStatus");
}

export async function getPendingSummaryByDepartment() {
  const { data, error } = await supabase
    .from("leave_requests")
    .select(`
      id,
      department_id,
      start_date,
      end_date,
      created_at,
      employees ( full_name ),
      departments ( name )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  assertNoError(error, "getPendingSummaryByDepartment");

  const map = new Map();

  for (const r of data ?? []) {
    const deptId = r.department_id ?? "unknown";
    const deptName = r.departments?.name ?? "Unknown";
    const empName = r.employees?.full_name ?? "Unknown";

    if (!map.has(deptId)) {
      map.set(deptId, {
        departmentId: deptId,
        departmentName: deptName,
        count: 0,
        items: [],
      });
    }

    const entry = map.get(deptId);
    entry.count += 1;
    entry.items.push({
      requestId: r.id,
      employeeName: empName,
      startDate: r.start_date,
      endDate: r.end_date,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a.departmentName).localeCompare(String(b.departmentName))
  );
}
