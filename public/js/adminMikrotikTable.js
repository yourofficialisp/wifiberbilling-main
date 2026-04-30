$(document).ready(function(){
    $('#pppoeTable').DataTable({
        "responsive": true,
        "scrollX": true,
        "columnDefs": [
            {
                "targets": [0], // No column
                "responsivePriority": 1
            },
            {
                "targets": [1], // Username column
                "responsivePriority": 2
            },
            {
                "targets": [-1], // Action column (last column)
                "responsivePriority": 3,
                "orderable": false
            }
        ],
        language: {
            search: 'Search:',
            lengthMenu: 'Tampilkan _MENU_ entri',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            paginate: {
                first: 'Pertama',
                last: 'Terakhir',
                next: 'Berikutnya',
                previous: 'Previous'
            },
            zeroRecords: 'Tidak ditemukan data yang cocok',
            infoEmpty: 'Showing 0 to 0 of 0 entries',
            infoFiltered: '(disaring dari _MAX_ total entri)'
        }
    });
});
