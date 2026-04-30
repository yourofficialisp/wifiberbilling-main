$(function() {
  // Custom sorting for status column: 'Aktif' > 'Offline'
  $.fn.dataTable.ext.order['status-aktif'] = function(settings, col) {
    return this.api().column(col, {order:'index'}).nodes().map(function(td, i) {
      const val = $(td).text().trim().toLowerCase();
      if (val === 'aktif') return 1;
      if (val === 'offline') return 0;
      return -1;
    });
  };

  const hotspotTable = $('#hotspotTable').DataTable({
    pageLength: 10,
    lengthMenu: [10, 25, 50, 100],
    responsive: true,
    dom: '<"d-flex justify-content-between align-items-center mb-3"<"d-flex align-items-center"l><"d-flex"f><"ms-3"#statusFilterContainer>>rtip',
    order: [[4, 'desc'], [0, 'asc']], // Status first, then No
    columnDefs: [
      { targets: 4, orderDataType: 'status-aktif' },
      { targets: -1, orderable: false, width: '20%', className: 'text-center' },
      { targets: 0, width: '5%', className: 'text-center' },
      { targets: 1, width: '20%', className: 'fw-bold text-start' },
      { targets: 2, width: '20%', className: 'text-center' },
      { targets: 3, width: '15%', className: 'text-center' },
      { targets: 4, width: '10%', className: 'text-center' }
    ],
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/en-gb.json',
      paginate: {
        previous: '<i class="bi bi-chevron-left"></i>',
        next: '<i class="bi bi-chevron-right"></i>'
      },
      info: 'Showing _START_ to _END_ of _TOTAL_ users',
      lengthMenu: 'Show _MENU_ users',
      search: 'Search:',
      zeroRecords: 'No users found',
      infoEmpty: 'Showing 0 to 0 of 0 users',
      infoFiltered: '(filtered from _MAX_ total users)'
    }
  });

  // Add status filter dropdown
  const statusFilter = $('<select class="form-select form-select-sm ms-2" style="width:auto; display:inline-block;"><option value="">All Status</option><option value="Aktif">Active</option><option value="Offline">Offline</option></select>');
  $('#statusFilterContainer').append(statusFilter);

  // Filter DataTables by status
  statusFilter.on('change', function() {
    const val = $(this).val();
    if (val) {
      hotspotTable.column(4).search('^' + val + '$', true, false).draw();
    } else {
      hotspotTable.column(4).search('', true, false).draw();
    }
    updateActiveUserCount();
    // Always sort Active status on top
    hotspotTable.order([4, 'desc'], [0, 'asc']).draw();
  });

  // Ensure status sort priority during search
  $('#hotspotTable_filter input').on('input', function() {
    // Wait briefly for search to be applied
    setTimeout(function() {
      hotspotTable.order([4, 'desc'], [0, 'asc']).draw();
    }, 100);
  });

  // Function to update active user count in statistics card
  function updateActiveUserCount() {
    let count = 0;
    hotspotTable.rows({ search: 'applied' }).every(function() {
      const data = this.data();
      if (data[4] && data[4].toLowerCase() === 'aktif') count++;
    });
    $('#activeUserCount').text(count);
  }

  // Update active user count when table is drawn
  hotspotTable.on('draw', function() {
    updateActiveUserCount();
  });

  // Initial load
  updateActiveUserCount();

  // Edit button handler
  $('#hotspotTable').on('click', '.edit-user-btn', function() {
    const username = $(this).data('username');
    const password = $(this).data('password');
    const profile = $(this).data('profile');
    // Show edit user modal, fill fields
    $('#editUsername').val(username);
    $('#editPassword').val(password);
    $('#editProfileeeeeeeeee').val(profile);
    $('#originalUsername').val(username);
    $('#editUserModal').modal('show');
  });

  // Delete button handler
  $('#hotspotTable').on('click', '.delete-user-btn', function() {
    const username = $(this).data('username');
    if (confirm('Are you sure you want to delete user ' + username + '?')) {
      // Submit delete form dynamically
      const form = $('<form>', { method: 'POST', action: '/admin/hotspot/delete' });
      form.append($('<input>', { type: 'hidden', name: 'username', value: username }));
      $('body').append(form);
      form.submit();
    }
  });

  // Disconnect button handler
  let disconnectUsername = '';
  $('#hotspotTable').on('click', '.disconnect-session-btn', function() {
    disconnectUsername = $(this).data('username');
    $('#disconnectUsername').text(disconnectUsername);
    $('#disconnectUserModal').modal('show');
  });

  // Confirm disconnect
  $('#confirmDisconnect').on('click', function() {
    if (!disconnectUsername) return;
    $.ajax({
      url: '/admin/hotspot/disconnect-user',
      method: 'POST',
      data: { username: disconnectUsername },
      success: function(res) {
        $('#disconnectUserModal').modal('hide');
        showToast('Successful', 'User ' + disconnectUsername + ' successfully disconnected.', 'success');
        setTimeout(() => window.location.reload(), 1000);
      },
      error: function(xhr) {
        $('#disconnectUserModal').modal('hide');
        let msg = 'Failed to disconnect user.';
        if (xhr.responseJSON && xhr.responseJSON.message) msg = xhr.responseJSON.message;
        showToast('Error', msg, 'danger');
      }
    });
  });

  // Toast notification function
  function showToast(title, message, type) {
    $('#toastTitle').text(title);
    $('#toastMessage').text(message);
    $('#toastHeader').removeClass('bg-success bg-danger bg-warning').addClass('bg-' + type);
    $('#toastIcon').removeClass().addClass('bi me-2 ' + (type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-x-circle-fill' : 'bi-exclamation-triangle-fill'));
    $('#notificationToast').toast('show');
  }
});

// Function to format hotspot user uptime
function formatUptime(uptimeStr) {
    if (!uptimeStr) return '-';
    
    // Format like 1d2h3m4s to 1 day 2 hours 3 minutes 4 seconds
    const days = uptimeStr.match(/([0-9]+)d/);
    const hours = uptimeStr.match(/([0-9]+)h/);
    const minutes = uptimeStr.match(/([0-9]+)m/);
    const seconds = uptimeStr.match(/([0-9]+)s/);
    
    let result = '';
    if (days) result += days[1] + ' days ';
    if (hours) result += hours[1] + ' hours ';
    if (minutes) result += minutes[1] + ' min ';
    if (seconds) result += seconds[1] + ' sec';
    
    return result.trim();
}
